import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Context, Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import z from "zod";
import { API, parseExtra, ServerResponse } from "../shared/util.ts";

export class AppError extends Error {
	constructor(public msg: string, public status: ContentfulStatusCode = 500) {
		super(msg);
	}
}

const app = new Hono();

export const doHash = (pass: string) =>
	createHash("SHA256").update(Buffer.from(pass)).digest().toString("hex");

async function parse<R>(t: z.ZodType<R>, c: Context): Promise<R> {
	if (c.req.header("Content-Type") != "application/json") {
		throw new AppError("non-json content type");
	}
	let res: z.ZodSafeParseResult<R>;
	try {
		res = t.safeParse(parseExtra(await c.req.raw.text()));
	} catch {
		throw new AppError("could not parse body");
	}
	if (res.error) {
		throw new AppError(`invalid body: ${res.error.message}`);
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
		route: K;
		handler: (...parameters: APIRouteParameters[K]["input"]) => APIRouteParameters[K]["output"];
	} & APIRouteParameters[K]["validator"];
};

function makeRoute<K extends keyof API>(route: APIRoute[K]) {
	app.post(`/${route.route}`, async c => {
		const req = "validator" in route ? await parse(route.validator, c) : undefined;
		const resp =
			await (route.handler as unknown as (
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

app.onError((err, c) => {
	console.error("request error", err);
	if (err instanceof AppError) return c.json({ type: "error", message: err.msg }, err.status);
	return c.json({ type: "error", message: "Unknown error" }, 500);
});

console.log("starting server");
serve({ fetch: app.fetch, port: 8090 });
console.log("server started");
