import { API, parseExtra, ServerResponse, stringifyExtra } from "../../shared/util";
import "vite/client";

export type APIRequest = {
	[K in keyof API]: API[K] extends { request: unknown }
		? [K, API[K]["request"]] | [K, API[K]["request"], (resp: ServerResponse<K>) => void]
		: [K] | [K, (resp: ServerResponse<K>) => void];
};

export class APIError extends Error {
	constructor(public msg: string) {
		super(msg);
	}
}

const apiBaseUrl = import.meta.env["VITE_API_BASE_URL"] == ""
	? new URL("/", self.location.href).href
	: import.meta.env["VITE_API_BASE_URL"] as string;

console.log(`api base url: ${apiBaseUrl}`);

export async function makeReq<T extends keyof API>(...args: APIRequest[T]) {
	const resp = await fetch(new URL(args[0], apiBaseUrl), {
		headers: { "Content-Type": "application/json" },
		body: typeof args[1] == "function" ? undefined : stringifyExtra(args[1]),
		method: "POST",
	});

	const data = parseExtra(await resp.text()) as ServerResponse<T>;
	if (typeof args[args.length-1] == "function") {
		(args[args.length-1] as (resp: ServerResponse<T>) => void)(data);
	}
	if (data.type == "error") throw new APIError(data.message);
	return data.data;
}
