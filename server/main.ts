import { SESClient } from "@aws-sdk/client-ses";
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Context as HonoContext, Hono } from "hono";
import { streamText } from "hono/streaming";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { Buffer } from "node:buffer";
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { OpenAI } from "openai";
import z from "zod";
import { API, APIError, parseExtra, ServerResponse, Session,
	stringifyExtra } from "../shared/util.ts";
import { getDb, transaction } from "./db.ts";
import "./routes.ts";
import { StreamingApi } from "hono/utils/stream";
import { promisify } from "node:util";
import { makeRoutes } from "./routes.ts";

export const env = z.parse(
	z.object({
		NOSEND_EMAIL: z.literal("1").optional(),
		AWS_REGION: z.string(),
		AWS_ACCESS_KEY_ID: z.string(),
		AWS_SECRET_ACCESS_KEY: z.string(),
		ROOT_URL: z.url(),
		TRUSTED_PROXY: z.string().optional(),
		ADMIN_API_KEY: z.string(),
		CLIENT_API_KEY: z.string(),
		OPENAI_API_KEY: z.string(),
		DOMJUDGE_URL: z.url(),
		DOMJUDGE_API_USER: z.string(),
		DOMJUDGE_API_KEY: z.string(),
		SCREENSHOT_PATH: z.string().optional(),
	}),
	process.env,
);

export type HonoEnv = { Variables: { session?: "clear" | Session } };
export type Context = HonoContext<HonoEnv>;

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

type APIInputContext<K extends keyof API> = API[K] extends { feed: true; response: unknown }
	? [StreamingApi, Context]
	: [Context];

type APIRouteParameters<K extends keyof API> = {
	validator: API[K] extends { request: unknown } ? { validator: z.ZodType<API[K]["request"]> }
		: object;
	input: API[K] extends { request: unknown } ? [...APIInputContext<K>, API[K]["request"]]
		: APIInputContext<K>;
	feed: API[K] extends { feed: true; response: unknown } ? { feed: true } : { feed?: false };
	output: API[K] extends { feed: true; response: unknown } ? AsyncGenerator<API[K]["response"]>
		: Promise<API[K] extends { response: unknown } ? API[K]["response"] : void>;
};

type APIRoute = {
	[K in keyof API]: {
		ratelimit?: { times: number; durationMs: number };
		handler: (
			this: DisposableStack,
			...parameters: APIRouteParameters<K>["input"]
		) => APIRouteParameters<K>["output"];
	} & APIRouteParameters<K>["validator"] & APIRouteParameters<K>["feed"];
};

function errToJson(err: unknown): ServerResponse<never> & { type: "error" } {
	if (err instanceof APIError) {
		return { type: "error", error: err.error };
	}
	return { type: "error", error: { type: "internal", msg: "Unknown error", status: 500 } };
}

type RateLimitBucket = { since: number; times: number };
const trustedProxy = env.TRUSTED_PROXY;

export function makeRoute<K extends keyof API>(app: Hono<HonoEnv>, route: K, data: APIRoute[K]) {
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
				throw new APIError({ msg: "Too many requests", status: 429, type: "badRequest" });
			}
		}

		const req = "validator" in data ? await parse(data.validator, c) : undefined;
		if (data.feed == true) {
			return streamText(c, async api => {
				const disp = new DisposableStack();
				try {
					const out =
						await (data.handler as unknown as (
							this: DisposableStack,
							api: StreamingApi,
							c: Context,
							request: typeof req,
						) => Promise<AsyncIterable<(ServerResponse<K> & { type: "ok" })["data"]>>).call(
							disp,
							api,
							c,
							req,
						);
					for await (const x of out) {
						await api.writeln(stringifyExtra({ type: "ok", data: x } satisfies ServerResponse<K>));
					}
				} catch (e) {
					console.error("feed error", e);
					await api.writeln(stringifyExtra(errToJson(e)));
				}
				disp.dispose();
				await api.close();
			});
		} else {
			const resp =
				await (data.handler as unknown as (
					c: Context,
					request: typeof req,
				) => Promise<APIRouteParameters<K>["output"]>)(c, req);

			const session = c.get("session");
			return c.json(
				{
					type: "ok",
					data: (resp ?? null) as unknown as (ServerResponse<K> & { type: "ok" })["data"],
					session,
				} satisfies ServerResponse<K>,
			);
		}
	});
}

const sessionExpireMs = 3600*1000*24*7;

const argon2Parameters = { parallelism: 1, tagLength: 32, memory: 8192, passes: 3 };

export const genKey = () => randomBytes(32);

export async function getKey(password: string) {
	password = password.normalize();
	const salt = randomBytes(32);
	const v = await promisify(argon2)("argon2id", {
		message: password,
		nonce: salt,
		...argon2Parameters,
	});
	return [salt.toString("hex"), v.toString("hex")].join(";");
}

export async function matchKey(key: string, password: string) {
	password = password.normalize();
	const [salt, derivedKey] = key.split(";");
	const v = await promisify(argon2)("argon2id", {
		message: password,
		nonce: Buffer.from(salt, "hex"),
		...argon2Parameters,
	});
	return v.toString("hex") == derivedKey;
}

const apiKeys = {
	admin: env.ADMIN_API_KEY != undefined ? await getKey(env.ADMIN_API_KEY) : null,
	client: env.CLIENT_API_KEY != undefined ? await getKey(env.CLIENT_API_KEY) : null,
};

export async function keyAuth(c: Context, admin: boolean) {
	const authHdr = c.req.header("Authorization");
	if (authHdr == undefined) throw err("No auth header", "auth");
	const bearerMatch = authHdr.match(/^Bearer (.+)$/);
	if (bearerMatch == null) throw err("Invalid auth header", "auth");
	const auth = (apiKeys.admin != null && await matchKey(apiKeys.admin, bearerMatch[1]))
		|| (apiKeys.client != null && await matchKey(apiKeys.client, bearerMatch[1]) && admin != true);
	if (!auth) throw err("Incorrect API key", "auth");
}

export async function auth(c: Context): Promise<number> {
	const authHdr = c.req.header("Authorization");
	if (authHdr == undefined) throw err("no auth header", "auth");
	const match = authHdr.match(/^Basic ([^ ]+) (.+)$/);
	if (match == null) throw err("Invalid auth header", "auth");
	const id = Number.parseInt(match[1]);
	const ses = await transaction(trx => getDb(trx, "session", id));
	if (ses == undefined) throw err("no session found", "auth");
	if (Date.now() >= ses.created+sessionExpireMs) throw err("session expired", "auth");
	if (!timingSafeEqual(ses.key, Buffer.from(match[2], "hex"))) {
		throw err("invalid session key", "auth");
	}
	return ses.user;
}

export const sesClient = new SESClient({ region: env.AWS_REGION });
export const openai = new OpenAI();

export const rootUrl = new URL(env.ROOT_URL);

const app = new Hono<HonoEnv>();
app.use("*", serveStatic({ root: "../client/dist" }));

app.onError((err, c) => {
	console.error("request error", err);
	const json = errToJson(err);
	return c.json(json, json.error.status as ContentfulStatusCode);
});

await makeRoutes(app);

console.log("starting server");
serve({ fetch: app.fetch, port: 8090 });
console.log("server started");
