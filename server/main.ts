import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Context as HonoContext, Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Readable } from "node:stream";
import { OpenAI } from "openai";
import z from "zod";
import { API, APIError, ContestProperties, fill, logoMaxSize, maxPromptLength, parseExtra,
	resumeMaxSize, ServerResponse, Session, shirtSizes, UserInfo, validDiscordRe,
	validNameRe } from "../shared/util.ts";
import { DBTransaction, getDb, getDbCheck, getProperties, getProperty, setDb, setProperty,
	transaction, updateDb, UserData } from "./db.ts";
import { makeVerificationEmail } from "./email.ts";

type HonoEnv = { Variables: { session?: "clear" | Session } };
const app = new Hono<HonoEnv>();
type Context = HonoContext<HonoEnv>;

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

		const session = c.get("session");
		return c.json(
			{
				type: "ok",
				data: (resp ?? null) as unknown as (ServerResponse<K> & { type: "ok" })["data"],
				session,
			} satisfies ServerResponse<K>,
		);
	});
}

app.use("*", serveStatic({ root: "../client/dist" }));

const sessionExpireMs = 3600*1000*24*7;

const apiKeys = {
	admin: process.env.ADMIN_API_KEY != undefined ? doHash(process.env.ADMIN_API_KEY) : null,
	client: process.env.CLIENT_API_KEY != undefined ? doHash(process.env.CLIENT_API_KEY) : null,
};

async function keyAuth(c: Context, admin?: boolean) {
	const authHdr = c.req.header("Authorization");
	if (authHdr == undefined) throw err("No auth header", "auth");
	const bearerMatch = authHdr.match(/^Bearer (.+)$/);
	if (bearerMatch == null) throw err("Invalid auth header", "auth");
	const auth = doHash(bearerMatch[1]) == apiKeys.admin
		|| (doHash(bearerMatch[1]) == apiKeys.client && admin != true);
	if (!auth) throw err("Incorrect API key", "auth");
}

async function auth(c: Context): Promise<number> {
	const authHdr = c.req.header("Authorization");
	if (authHdr == undefined) throw err("no auth header", "auth");
	const match = authHdr.match(/^Basic ([^ ]+) (.+)$/);
	if (match == null) throw err("Invalid auth header", "auth");
	const id = Number.parseInt(match[1]);
	const ses = await transaction(trx => getDb(trx, "session", id));
	if (ses == undefined) throw err("no session found", "auth");
	if (Date.now() >= ses.created+sessionExpireMs) throw err("session expired", "auth");
	if (ses.key != doHash(match[2])) throw err("invalid session key", "auth");
	return ses.user;
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
const inPersonSchema = z.object({
	needTransportation: z.boolean(),
	pizza: z.enum(["cheese", "pepperoni", "sausage", "none"]),
	sandwich: z.enum([
		"chickenBaconRancher",
		"chipotleChickenAvoMelt",
		"toastedGardenCaprese",
		"baconTurkeyBravo",
		"none",
	]),
	shirtSize: z.enum(shirtSizes),
});
const discordSchema = z.string().regex(new RegExp(validDiscordRe));
const userInfoSchema = z.object({
	name: nameSchema,
	discord: discordSchema.nullable(),
	inPerson: inPersonSchema.nullable(),
});
const partialUserInfoSchema = z.object({
	name: nameSchema.optional(),
	discord: discordSchema.nullable(),
	inPerson: inPersonSchema.partial().and(z.object({ needTransportation: z.boolean() })).nullable(),
});

const sesClient = new SESClient({ region: process.env.AWS_REGION });
const openai = new OpenAI();

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
					Source: "noreply@email.purduecpu.com",
					Message: {
						Subject: { Charset: "UTF-8", Data: "HammerWars 2025: Finish setting up your account" },
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

async function makeSession(c: Context, trx: DBTransaction, userId: number) {
	const sesKey = genKey();
	const sesId = await setDb(trx, "session", null, {
		user: userId,
		created: Date.now(),
		key: doHash(sesKey),
	});

	c.set("session", { id: sesId, key: sesKey });
}

function removeSession(c: Context) {
	c.set("session", "clear");
}

makeRoute("createAccount", {
	validator: z.object({ id: z.number(), key: z.string(), password: passwordSchema }),
	handler: async (c, req) => {
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
				const data: UserData = {
					info: { inPerson: null, discord: null },
					submitted: null,
					lastEdited: Date.now(),
					...saltHash,
				};
				userId = await setDb(trx, "user", null, { email: row.email, team: null, data });
			}

			await makeSession(c, trx, userId);
		});
	},
});

makeRoute("login", {
	validator: z.object({ email: z.email(), password: passwordSchema }),
	handler: async (c, req) => {
		return await transaction(async trx => {
			const row = await trx.selectFrom("user").select("id").where("email", "=", req.email)
				.executeTakeFirst();
			if (!row) return "incorrect";
			const u = await getDbCheck(trx, "user", row.id);
			if (doHash(req.password, u.data.passwordSalt) != u.data.passwordHash) return "incorrect";
			await makeSession(c, trx, row.id);
			return null;
		});
	},
});

makeRoute("setPassword", {
	validator: z.object({ newPassword: passwordSchema }),
	handler: async (c, req) => {
		const userId = await auth(c);
		const salt = genKey();
		return await transaction(async trx => {
			await updateDb(
				trx,
				"user",
				userId,
				async old => ({
					...old,
					data: { ...old.data, passwordHash: doHash(req.newPassword, salt), passwordSalt: salt },
				}),
			);

			await trx.deleteFrom("session").where("user", "=", userId).execute();
			await makeSession(c, trx, userId);
		});
	},
});

makeRoute("checkSession", {
	handler: async c => {
		await auth(c);
	},
});

makeRoute("updateResume", {
	validator: z.object({ type: z.literal("add"), base64: z.base64() }).or(
		z.object({ type: z.literal("remove") }),
	),
	async handler(c, req) {
		const userId = await auth(c);
		await transaction(async trx => {
			if ((await getDbCheck(trx, "user", userId)).data.submitted != null) {
				throw err("You must unsubmit to modify your resume");
			}

			if (req.type == "add") {
				const resume = Buffer.from(req.base64, "base64");
				if (resume.byteLength > resumeMaxSize) {
					throw err("resume is too large");
				}
				await trx.insertInto("resume").values({ user: userId, file: resume }).onConflict(c =>
					c.doUpdateSet({ file: resume })
				).execute();
			} else if (req.type == "remove") {
				await trx.deleteFrom("resume").where("user", "=", userId).execute();
			}
		});
	},
});

makeRoute("updateInfo", {
	validator: z.object({
		info: partialUserInfoSchema,
		resume: z.object({ type: z.literal("add"), base64: z.base64() }).or(
			z.object({ type: z.literal("remove") }),
		).optional(),
		submit: z.boolean(),
	}),
	handler: async (c, req) => {
		const userId = await auth(c);
		await transaction(async trx =>
			updateDb(trx, "user", userId, async old => {
				if (old.data.submitted && req.submit) {
					throw err("You must unsubmit to update your information");
				}

				let submitted: UserInfo | null = null;
				if (req.submit) {
					if (await getProperty(trx, "registrationOpen") != true) {
						throw err("Registration is not open");
					}
					const ends = await getProperty(trx, "registrationEnds");
					if (ends != null && Date.now() >= ends) {
						throw err("Registration has ended");
					}
					const parsed = userInfoSchema.safeParse(req.info);
					if (!parsed.success) throw err("Can't submit: not fully filled out");
					if (parsed.data.inPerson) {
						const hasResume = await trx.selectFrom("resume").where("user", "=", userId).select("id")
							.executeTakeFirst();
						if (hasResume == undefined) {
							throw err("Can't submit: no resume provided for in-person participant");
						}
					}
					submitted = parsed.data;
				}

				return { ...old, data: { ...old.data, info: req.info, submitted, lastEdited: Date.now() } };
			})
		);
	},
});

makeRoute("deleteUser", {
	handler: async c => {
		const userId = await auth(c);
		await transaction(trx => setDb(trx, "user", userId, null));
		removeSession(c);
	},
});

async function setTeamLogo(trx: DBTransaction, team: number, logo: Buffer, logoMime: string) {
	// dont upsert so id changes
	await trx.deleteFrom("teamLogo").where("team", "=", team).execute();
	await trx.insertInto("teamLogo").values({ logo: logo, logoMime, team }).execute();
}

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

			let teamId: number;
			if (u.team != null) {
				teamId = u.team;
				await setDb(trx, "team", u.team, { name: req.name });
			} else {
				teamId = await setDb(trx, "team", null, {
					joinCode: fill(10, () => randomInt(0, 9).toString()).join(""),
					name: req.name,
				});

				await setDb(trx, "user", userId, { team: teamId });
			}

			if (req.logo == "remove") {
				await trx.deleteFrom("teamLogo").where("team", "=", teamId).execute();
			} else if (req.logo != null) {
				const logo = Buffer.from(req.logo.base64, "base64");
				if (logo.byteLength > logoMaxSize) {
					throw err(`team logo is too large`);
				}
				await setTeamLogo(trx, teamId, logo, req.logo.mime);
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
			const resume = await trx.selectFrom("resume").select("id").where("user", "=", userId)
				.executeTakeFirst();
			const data2 = {
				info: data.info,
				submitted: data.submitted != null,
				lastEdited: data.lastEdited,
				hasResume: resume != undefined,
			};

			if (team != null) {
				const teamData = await getDbCheck(trx, "team", team);
				const logo = await trx.selectFrom("teamLogo").select("teamLogo.id").where("team", "=", team)
					.executeTakeFirst();
				return {
					...data2,
					team: {
						logo: logo != null ? `teamLogo/${logo.id}` : null,
						joinCode: teamData.joinCode,
						name: teamData.name,
					},
				};
			}

			return { ...data2, team: null };
		});
	},
});

makeRoute("registrationWindow", {
	async handler(_c) {
		return await transaction(async trx => ({
			open: await getProperty(trx, "registrationOpen") ?? false,
			closes: await getProperty(trx, "registrationEnds"),
		}));
	},
});

makeRoute("getProperties", {
	async handler(c) {
		await keyAuth(c);
		return await transaction(trx => getProperties(trx));
	},
});

makeRoute("setProperties", {
	validator: z.object({
		registrationEnds: z.number(),
		registrationOpen: z.boolean(),
		internetAccessAllowed: z.boolean(),
	}).partial().strip(),
	async handler(c, req) {
		await keyAuth(c);
		await transaction(async trx => {
			// zod strips unknown keys
			for (const k in req) {
				const contestKey = k as keyof ContestProperties;
				if (req[contestKey] != undefined) {
					await setProperty(trx, contestKey, req[contestKey]);
				}
			}
		});
	},
});

makeRoute("getResume", {
	async handler(c) {
		const uid = await auth(c);
		const resumeData = await transaction(trx =>
			trx.selectFrom("resume").where("user", "=", uid).select("file").executeTakeFirst()
		);
		if (!resumeData) throw err("Resume not uploaded");
		// 💀 im so sorry
		return resumeData.file.toString("base64");
	},
});

makeRoute("generateLogo", {
	validator: z.object({ prompt: z.string().max(maxPromptLength) }),
	ratelimit: { times: 5, durationMs: 3600*1000 },
	async handler(c, req) {
		const userId = await auth(c);
		const [teamId, teamName] = await transaction(async trx => {
			const teamId = (await getDbCheck(trx, "user", userId)).team;
			if (teamId == null) throw err("user not in a team");
			return [teamId, (await getDbCheck(trx, "team", teamId)).name] as const;
		});
		const res = await openai.images.generate({
			model: "gpt-image-1",
			prompt:
				`Create a team logo for a programming contest for a team named "${teamName}. It should work well on a black background. ${req.prompt}`,
			quality: "medium",
			output_format: "png",
		});
		const data = res.data?.[0]?.b64_json;
		if (data == null) throw err("Image was not generated");
		const logo = Buffer.from(data, "base64");
		await transaction(trx => setTeamLogo(trx, teamId, logo, "image/png"));
	},
});

app.get("/teamLogo/:id", async c => {
	const id = c.req.param().id;
	const idInt = Number.parseInt(id);
	if (!isFinite(idInt)) throw err("invalid id");
	const data = await transaction(trx => getDbCheck(trx, "teamLogo", idInt));
	if (!data.logo || data.logoMime == null) throw err("no logo for team");
	return c.body(Readable.toWeb(Readable.from(data.logo)), 200, { "Content-Type": data.logoMime });
});

console.log("starting server");
serve({ fetch: app.fetch, port: 8090 });
console.log("server started");
