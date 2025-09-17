import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { API, APIError, parseExtra, ServerResponse, Session,
	stringifyExtra } from "../../shared/util";

export type LocalStorage = Partial<{ session: Session }> & { toJSON(): unknown };
const localStorageKeys: (Exclude<keyof LocalStorage, "toJSON">)[] = ["session"];

export const LocalStorage = {} as unknown as LocalStorage;

for (const k of localStorageKeys) {
	Object.defineProperty(LocalStorage, k, {
		get() {
			const vStr = localStorage.getItem(k);
			return vStr != null ? parseExtra(vStr) : undefined;
		},
		set(newV) {
			if (newV == undefined) localStorage.removeItem(k);
			else localStorage.setItem(k, stringifyExtra(newV));
			return newV as unknown;
		},
	});
}

type APIRequest<T extends keyof API> = API[T] extends { request: unknown } ? [API[T]["request"]]
	: [];
export type APIRequestParameters = {
	[K in keyof API]: [K, ...APIRequest<K>] | [
		K,
		...APIRequest<K>,
		(resp: ServerResponse<K>) => void,
	];
};

export const apiBaseUrl = new URL("/api/", import.meta.env["VITE_ROOT_URL"] as string).href;

console.log(`api base url: ${apiBaseUrl}`);

export async function makeRequest<T extends keyof API>(...args: APIRequestParameters[T]) {
	const session = LocalStorage.session;
	const resp = await fetch(new URL(args[0], apiBaseUrl), {
		headers: {
			"Content-Type": "application/json",
			...session ? { Authorization: `Basic ${session.id} ${session.key}` } : {},
		},
		body: typeof args[1] == "function" ? undefined : stringifyExtra(args[1]),
		credentials: import.meta.env.DEV ? "include" : "same-origin",
		method: "POST",
	});

	const data = parseExtra(await resp.text()) as ServerResponse<T>;
	if (typeof args[args.length-1] == "function") {
		(args[args.length-1] as (resp: ServerResponse<T>) => void)(data);
	}
	if (data.type == "error") {
		throw new APIError(data.error);
	}
	return data.data;
}
type CurrentRequest<T extends keyof API> = {
	current: ServerResponse<T>;
	request: API[T] extends { request: unknown } ? API[T]["request"] : null;
} | { current: null; request: null };

export function useRequest<T extends keyof API>(
	{ route, initRequest, handler, noThrow }: {
		route: T;
		initRequest?: API[T] extends { request: unknown } ? API[T]["request"] : true;
		handler?: (resp: ServerResponse<T>) => void;
		noThrow?: boolean;
	},
): Readonly<
	CurrentRequest<T> & {
		loading: boolean;
		call: (...params: APIRequest<T>) => void;
		reset: () => void;
	}
> {
	const [err, setErr] = useState<unknown>(null);
	const [loading, setLoading] = useState(0);
	const [current, setCurrent] = useState<CurrentRequest<T>>({ current: null, request: null });
	const handlerRef = useRef(handler);
	useEffect(() => {
		handlerRef.current = handler;
	}, [handler]);
	const call = useCallback((...params: APIRequest<T>) => {
		setLoading(i => i+1);
		makeRequest<T>(
			...[route, ...params, (res: ServerResponse<T>) => {
				setCurrent({
					current: res,
					request: (params.length > 0 ? params[0] : null) as unknown as CurrentRequest<
						T
					>["request"],
				});
				handlerRef.current?.(res);
			}] as unknown as APIRequestParameters[T],
		).catch(setErr).finally(() => setLoading(i => i-1));
	}, [route]);
	useEffect(() => {
		if (initRequest != undefined) {
			call(...(initRequest == true ? [] : [initRequest]) as APIRequest<T>);
		}
	}, [call, initRequest, route]);
	useEffect(() => {
		if (err instanceof Error && noThrow != true) throw err;
	}, [err, noThrow]);
	return {
		...current,
		loading: loading > 0,
		call,
		reset: useCallback(() => {
			setErr(null);
			setCurrent({ current: null, request: null });
		}, []),
	} as const;
}
