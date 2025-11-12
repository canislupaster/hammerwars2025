// code i have lying around
// we wouldn't want to exceed CF ratelimit, now, would we?

import { ProxyAgent } from "undici";
import { env } from "./env";

const dispatchers: (ProxyAgent | undefined)[] = [];
const waiters: (() => void)[] = [];
const mainWaiters: (() => void)[] = [];

function shuffle<T>(arr: T[]) {
	for (let i = 1; i < arr.length; i++) {
		const j = Math.floor(Math.random()*(i+1));
		const x = arr[j];
		arr[j] = arr[i];
		arr[i] = x;
	}
}

const proxArr: string[] = [];
if (env.PROXY_FETCH_URL != undefined) {
	console.log("fetching proxies...");
	proxArr.push(...(await (await fetch(env.PROXY_FETCH_URL)).text()).trim().split("\n"));
}

console.log(`adding ${proxArr.length} proxies`);

for (const p of proxArr) {
	const parts = p.split(":");
	if (parts.length != 2 && parts.length != 4) {
		throw new Error(`expected 2 (host,port) or 4 parts (host,port,user,pass) for proxy ${p}`);
	}
	dispatchers.push(
		new ProxyAgent({
			uri: `http://${parts[0]}:${parts[1]}`,
			token: parts.length == 2
				? undefined
				: `Basic ${Buffer.from(`${parts[2]}:${parts[3]}`).toString("base64")}`,
		}),
	);
}

shuffle(dispatchers);
let mainReady = true;

const dispatcherWait = 500, dispatcherErrorWait = 30_000, timeout = 10_000;
const waiterLimit = 25;

export type FetchOpts = { noproxy?: boolean; nocache?: boolean };

export async function fetchDispatcher<T>(
	{ noproxy, nocache }: FetchOpts,
	transform: (r: Response) => Promise<T>,
	...args: Parameters<typeof fetch>
): Promise<T> {
	let err: unknown;
	for (let retryI = 0; retryI < 5; retryI++) {
		let d: ProxyAgent | undefined = undefined;

		if (
			(noproxy == true && mainWaiters.length >= waiterLimit)
			|| (noproxy != true && waiters.length >= waiterLimit)
		) {
			throw new Error("ran out of proxies");
		}

		if (noproxy == true) {
			while (!mainReady) {
				await new Promise<void>(res => mainWaiters.push(res));
			}
		} else {
			while (dispatchers.length == 0 && !mainReady) {
				await new Promise<void>(res => waiters.push(res));
			}

			if (dispatchers.length > 0) d = dispatchers.pop();
		}

		if (d === undefined) mainReady = false;

		let wait = dispatcherWait;

		try {
			const hdrs = new Headers(args[1]?.headers);

			const resp = await fetch(args[0], {
				...args[1],
				// @ts-ignore
				dispatcher: d,
				cache: nocache == true ? "no-cache" : undefined,
				headers: hdrs,
				signal: AbortSignal.timeout(timeout),
			});

			const retryAfter = resp.headers.get("Retry-After");
			if (resp.status == 429 && retryAfter != null) {
				let waitTime = Number.parseFloat(retryAfter)*1000;
				if (!Number.isFinite(waitTime)) {
					const date = Date.parse(retryAfter);
					if (!Number.isNaN(date)) waitTime = Math.max(0, date-Date.now());
				}
				if (!Number.isFinite(waitTime) || waitTime <= 0) {
					throw new Error(`couldn't parse retry-after header value ${retryAfter}`);
				}
				await new Promise<void>(res => setTimeout(res, waitTime));
				continue;
			}

			return await transform(resp);
		} catch (e) {
			err = e;
			wait = dispatcherErrorWait;
			continue;
		} finally {
			setTimeout(() => {
				if (d === undefined) mainReady = true;
				else dispatchers.push(d);

				const mw = mainWaiters.shift();
				if (mw !== undefined) mw();
				else {
					const w = waiters.shift();
					if (w !== undefined) w();
				}
			}, wait);
		}
	}

	console.error(err);
	throw new Error("ran out of retries trying to fetch data");
}
