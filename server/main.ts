import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Context, Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Readable } from "node:stream";
import z from "zod";
import { API, APIError, fill, logoMaxSize, parseExtra, ServerResponse,
	validNameRe } from "../shared/util.ts";
import { DBTransaction, getDb, getDbCheck, setDb, transaction, updateDb, UserData } from "./db.ts";
import { makeVerificationEmail } from "./email.ts";

const app = new Hono();

export function doHash(...pass: string[]) {
	const h = createHash("SHA256");
	for (const s of pass) h.update(Buffer.from(s));
	return h.digest().toString("hex");
}

export const genKey = () => randomBytes(16).toString("hex");

export const err = (msg: string, type?: "auth"): APIError =>
	new APIError(
		type == "auth"
			? { msg, type: "needLogin", status: 403 }
			: { msg, type: "badRequest", status: 400 },
	);

async function parse<R>(t: z.ZodType<R>, c: Context): Promise<R> {
	if (c.req.header("Content-Type") != "application/json") {
		throw err("non-json content type");
	}
	let res: z.ZodSafeParseResult<R>;
	try {
		res = t.safeParse(parseExtra(await c.req.raw.text()));
	} catch {
		throw err("could not parse body");
	}
	if (res.error) {
		throw err(`invalid body: ${res.error.message}`);
	}
	return res.data;
}

type APIRouteParameters = {
	[K in keyof API]: {
		validator: API[K] extends { request: unknown } ? { validator: z.ZodType<API[K]["request"]> }
			: object;
		input: API[K] extends { request: unknown } ? [Context, API[K]["request"]] : [Context];
		output: Promise<API[K] extends { response: unknown } ? API[K]["response"] : void>;
	};
};

const minuteMs = 60*1000;

type APIRoute = {
	[K in keyof API]: {
		ratelimit?: { times: number; durationMs: number };
		handler: (...parameters: APIRouteParameters[K]["input"]) => APIRouteParameters[K]["output"];
	} & APIRouteParameters[K]["validator"];
};

type RateLimitBucket = { since: number; times: number };
const trustedProxy = process.env.TRUSTED_PROXY;

function makeRoute<K extends keyof API>(route: K, data: APIRoute[K]) {
	const buckets = new Map<string, RateLimitBucket>();
	app.post(`/${route}`, async c => {
		let ip = getConnInfo(c).remote.address;
		if (trustedProxy != undefined && ip == trustedProxy) {
			ip = c.req.raw.headers.get("x-forwarded-for")?.split(",")?.[0]?.trim();
		}
		if (ip == undefined) throw err("Couldn't determine remote IP address.");

		if (data.ratelimit) {
			let bucket = buckets.get(ip);
			if (bucket == undefined || bucket.since < Date.now()-data.ratelimit.durationMs) {
				bucket = { since: Date.now(), times: 0 };
				buckets.set(ip, bucket);
			}

			bucket.times++;
			if (bucket.times > data.ratelimit.times) {
				throw new APIError({ msg: "Too many requests", status: 429, type: "internal" });
			}
		}

		const req = "validator" in data ? await parse(data.validator, c) : undefined;
		const resp =
			await (data.handler as unknown as (
				c: Context,
				request: typeof req,
			) => Promise<APIRouteParameters[K]["output"]>)(c, req);
		return c.json(
			{
				type: "ok",
				data: (resp ?? null) as unknown as (ServerResponse<K> & { type: "ok" })["data"],
			} satisfies ServerResponse<K>,
		);
	});
}

app.use("*", serveStatic({ root: "../client/dist" }));

const sessionExpireMs = 3600*1000*24*7;

async function auth(c: Context): Promise<number> {
	const authHdr = c.req.header("Authorization");
	if (authHdr == undefined) throw err("no auth header", "auth");
	const match = authHdr.match(/^Basic ([^ ]) (.+)$/);
	if (match == null) throw err("invalid auth header");
	const id = Number.parseInt(match[1]);
	const ses = await transaction(trx => getDb(trx, "session", id));
	if (ses == undefined) throw err("no session found", "auth");
	if (Date.now() >= ses.created+sessionExpireMs) throw err("session expired", "auth");
	if (ses.key == doHash(match[2])) return ses.user;
	throw err("invalid session key", "auth");
}

app.onError((err, c) => {
	console.error("request error", err);
	if (err instanceof APIError) {
		return c.json(
			{ type: "error", error: err.error } satisfies ServerResponse<never>,
			err.error.status as ContentfulStatusCode,
		);
	}
	return c.json(
		{
			type: "error",
			error: { type: "internal", msg: "Unknown error", status: 500 },
		} as ServerResponse<never>,
		500,
	);
});

const passwordSchema = z.string().min(8).max(100);
const nameSchema = z.string().regex(new RegExp(validNameRe));
const userInfoSchema = z.object({
	name: nameSchema,
	discord: nameSchema.nullable(),
	inPerson: z.object({
		needTransportation: z.boolean(),
		pizza: z.enum(["cheese", "pepperoni", "sausage"]).nullable(),
		sandwich: z.enum(["veggieWrap", "spicyChicken", "chicken"]).nullable(),
	}).nullable(),
});

const sesClient = new SESClient({ region: process.env.AWS_REGION });
export const rootUrl = new URL(process.env.ROOT_URL!);

makeRoute("register", {
	validator: z.object({ email: z.email() }),
	ratelimit: { durationMs: 3600*1000*24, times: 5 },
	handler: async (_c, req) => {
		const verifyKey = genKey();
		const newId = await transaction(async trx => {
			const exists = await trx.selectFrom("emailVerification").selectAll().where(
				"email",
				"=",
				req.email,
			).executeTakeFirst();
			if (exists) return null;

			return (await trx.insertInto("emailVerification").returning("id").values({
				email: req.email,
				key: doHash(verifyKey),
			}).executeTakeFirstOrThrow()).id;
		});

		if (newId != null) {
			const url = new URL("/verify", rootUrl);
			url.searchParams.append("id", newId.toString());
			url.searchParams.append("key", verifyKey);

			const response = await sesClient.send(
				new SendEmailCommand({
					Destination: { ToAddresses: [req.email], CcAddresses: [], BccAddresses: [] },
					Source: "noreply@mail.hammerwars.win",
					Message: {
						Subject: { Charset: "UTF-8", Data: "Continue registering for HammerWars" },
						Body: { Html: { Charset: "UTF-8", Data: makeVerificationEmail(url.href) } },
					},
				}),
			);

			console.log(`sent to ${req.email} (id ${response.MessageId})`);
		}

		return newId == null ? "alreadySent" : "sent";
	},
});

makeRoute("checkEmailVerify", {
	validator: z.object({ id: z.number(), key: z.string() }),
	handler: async (_c, req) => {
		return await transaction(async trx => {
			return (await getDb(trx, "emailVerification", req.id))?.key == doHash(req.key);
		});
	},
});

async function makeSession(trx: DBTransaction, userId: number) {
	const sesKey = genKey();
	const sesId = await setDb(trx, "session", null, {
		user: userId,
		created: Date.now(),
		key: doHash(sesKey),
	});

	return { id: sesId, key: sesKey };
}

makeRoute("createAccount", {
	validator: z.object({ id: z.number(), key: z.string(), password: passwordSchema }),
	handler: async (_c, req) => {
		return await transaction(async trx => {
			const row = await trx.selectFrom("emailVerification").selectAll().where("id", "==", req.id)
				.executeTakeFirst();
			if (row?.key != doHash(req.key)) throw err("Invalid verification key");

			const prevUser = await trx.selectFrom("user").select("id").where("email", "=", row.email)
				.executeTakeFirst();

			let userId: number;
			const salt = genKey();
			const saltHash = { passwordSalt: salt, passwordHash: doHash(req.password, salt) };

			if (prevUser) {
				await updateDb(
					trx,
					"user",
					prevUser.id,
					async o => ({ ...o, data: { ...o.data, ...saltHash } }),
				);
				userId = prevUser.id;
			} else {
				const data: UserData = { info: {}, submitted: null, lastEdited: Date.now(), ...saltHash };
				userId = await setDb(trx, "user", null, { email: row.email, team: null, data });
			}

			const sesKey = genKey();
			const sesId = await setDb(trx, "session", null, {
				user: userId,
				created: Date.now(),
				key: doHash(sesKey),
			});

			return { id: sesId, key: sesKey };
		});
	},
});

makeRoute("login", {
	validator: z.object({ email: z.email(), password: passwordSchema }),
	handler: async (_c, req) => {
		return await transaction(async trx => {
			const row = await trx.selectFrom("user").select("id").where("email", "=", req.email)
				.executeTakeFirst();
			if (!row) return "incorrect";
			const u = await getDbCheck(trx, "user", row.id);
			if (doHash(req.password, u.data.passwordSalt) != u.data.passwordHash) return "incorrect";
			return await makeSession(trx, row.id);
		});
	},
});

makeRoute("setPassword", {
	validator: z.object({ newPassword: passwordSchema }),
	handler: async (_c, req) => {
		const userId = await auth(_c);
		await transaction(async trx => {
			await updateDb(
				trx,
				"user",
				userId,
				async old => ({ ...old, data: { ...old.data, passwordHash: doHash(req.newPassword) } }),
			);

			await trx.deleteFrom("session").where("user", "=", userId).execute();
		});
	},
});

makeRoute("checkSession", {
	handler: async c => {
		await auth(c);
	},
});

makeRoute("updateInfo", {
	validator: z.object({ info: userInfoSchema.partial(), submit: z.boolean() }),
	handler: async (c, req) => {
		const userId = await auth(c);
		await transaction(async trx =>
			updateDb(trx, "user", userId, async old => {
				let submitted = null;
				if (req.submit) {
					const parsed = userInfoSchema.safeParse(req.info);
					if (!parsed.success) throw err("Can't submit: not fully filled out");
					submitted = parsed.data;
				}
				return { ...old, data: { ...old.data, info: req.info, submitted } };
			})
		);
	},
});

makeRoute("deleteUser", {
	handler: async c => {
		const userId = await auth(c);
		await transaction(trx => setDb(trx, "user", userId, null));
	},
});

makeRoute("setTeam", {
	validator: z.object({
		name: nameSchema,
		logo: z.object({ base64: z.base64(), mime: z.enum(["image/png", "image/jpeg"]) }).nullable().or(
			z.literal("remove"),
		),
	}),
	handler: async (c, req) => {
		const userId = await auth(c);
		await transaction(async trx => {
			const u = await getDb(trx, "user", userId);
			if (u == null) throw err("user does not exist");

			const logo = req.logo == undefined
				? {}
				: req.logo == "remove"
				? { logo: null }
				: { logo: Buffer.from(req.logo.base64, "base64"), logoMime: req.logo.mime };

			if (logo.logo && logo.logo.byteLength > logoMaxSize) {
				throw err(`team logo is too large (> ${logoMaxSize/1024} KB)`);
			}

			if (u.team != null) {
				await setDb(trx, "team", u.team, { name: req.name, ...logo });
			} else {
				const teamId = await setDb(trx, "team", null, {
					joinCode: fill(10, () => randomInt(0, 9).toString()).join(""),
					...logo,
					name: req.name,
				});

				await setDb(trx, "user", userId, { team: teamId });
			}
		});
	},
});

makeRoute("joinTeam", {
	validator: z.object({ joinCode: z.string() }),
	ratelimit: { times: 5, durationMs: 5000 },
	handler: async (c, req) => {
		const userId = await auth(c);
		await transaction(async trx => {
			if ((await getDbCheck(trx, "user", userId)).team != null) {
				throw err("You need to leave your team first");
			}
			const team = await trx.selectFrom("team").selectAll().where("joinCode", "==", req.joinCode)
				.executeTakeFirst();
			if (!team) throw err("Invalid join code.");
			await setDb(trx, "user", userId, { team: team.id });
		});
	},
});

makeRoute("leaveTeam", {
	handler: async c => {
		const userId = await auth(c);
		await transaction(async trx => {
			const u = await getDb(trx, "user", userId);
			if (u?.team == null) throw err("User is not in a team");
			await setDb(trx, "user", userId, { team: null });
			const count = await trx.selectFrom("user").select(s => s.fn.countAll<number>().as("count"))
				.where("team", "=", u.team).executeTakeFirstOrThrow();
			if (count.count == 0) await setDb(trx, "team", u.team, null);
		});
	},
});

makeRoute("getInfo", {
	handler: async c => {
		const userId = await auth(c);
		return await transaction(async trx => {
			const { data, team } = await getDbCheck(trx, "user", userId);
			const data2 = {
				info: data.info,
				submitted: data.submitted != null,
				lastEdited: data.lastEdited,
			};

			if (team != null) {
				const teamData = await getDbCheck(trx, "team", team);
				return {
					...data2,
					team: {
						logo: teamData.logo != null ? `teamLogo/${teamData.id}` : null,
						joinCode: teamData.joinCode,
						name: teamData.name,
					},
				};
			}

			return { ...data2, team: null };
		});
	},
});

app.get("/teamLogo/:id", async c => {
	const id = c.req.param().id;
	const idInt = Number.parseInt(id);
	if (!isFinite(idInt)) throw err("invalid id");
	const data = await transaction(trx => getDbCheck(trx, "team", idInt));
	if (!data.logo || data.logoMime == null) throw err("no logo for team");
	return c.body(Readable.toWeb(Readable.from(data.logo)), 200, { "Content-Type": data.logoMime });
});

console.log("starting server");
serve({ fetch: app.fetch, port: 8090 });
console.log("server started");
