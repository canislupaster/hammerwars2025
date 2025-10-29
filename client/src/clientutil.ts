import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { API, APIClient, APIError, APIRequest, APIRequestBase, FeedAPI, NonFeedAPI, parseExtra,
	ServerResponse, Session, stringifyExtra } from "../../shared/util";
import { useAsync } from "./ui";

export type LocalStorage = Partial<{ session: Session; apiKey: string }> & { toJSON(): unknown };
const localStorageKeys = ["session", "apiKey"] as const satisfies Exclude<
	keyof LocalStorage,
	"toJSON"
>[];

// i keep forgetting to add stuff to keys...
undefined as unknown as Exclude<
	keyof LocalStorage,
	"toJSON"
> satisfies typeof localStorageKeys[number];

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

export const apiBaseUrl = new URL("/api/", location.href).href;
console.log(`api base url: ${apiBaseUrl}`);

export const apiClient = new APIClient(apiBaseUrl, {
	session: LocalStorage.session ?? null,
	apiKey: null,
	onSessionChange: x => {
		LocalStorage.session = x ?? undefined;
	},
});

type CurrentRequest<T extends keyof API, Throw extends boolean> = {
	current: Throw extends true ? (ServerResponse<T> & { type: "ok" }) : ServerResponse<T>;
	request: API[T] extends { request: unknown } ? API[T]["request"] : null;
} | { current: null; request: null };

export function useRequest<T extends keyof NonFeedAPI, Throw extends boolean = true>(
	{ route, initRequest, handler, throw: doThrow }: {
		route: T;
		initRequest?: API[T] extends { request: unknown } ? API[T]["request"] : true;
		handler?: (resp: NonNullable<CurrentRequest<T, Throw>["current"]>) => void;
		throw?: Throw;
	},
): Readonly<
	CurrentRequest<T, Throw> & {
		loading: boolean;
		call: (...params: APIRequest<T>) => void;
		reset: () => void;
	}
> {
	const [err, setErr] = useState<unknown>(null);
	const [loading, setLoading] = useState(0);
	const [current, setCurrent] = useState<CurrentRequest<T, Throw>>({
		current: null,
		request: null,
	});
	const handlerRef = useRef(handler);
	useEffect(() => {
		handlerRef.current = handler;
	}, [handler]);
	const call = useCallback((...params: APIRequest<T>) => {
		setLoading(i => i+1);
		const request = (params.length > 0 ? params[0] : null) as unknown as CurrentRequest<
			T,
			Throw
		>["request"];
		apiClient.request<T>(route, ...params).then(v => {
			const current: ServerResponse<T> & { type: "ok" } = { type: "ok", data: v };
			setCurrent({ current, request });
			handlerRef.current?.(current);
		}).catch(err => {
			let resp: ServerResponse<T>;
			if (err instanceof APIError) resp = { type: "error", error: err.error };
			else {
				resp = {
					type: "error",
					error: {
						type: "fetch",
						msg: err instanceof Error ? err.message : "Error fetching from API",
						status: 400,
					},
				};
			}

			if (doThrow == false) {
				const current = resp as unknown as NonNullable<CurrentRequest<T, Throw>["current"]>;
				handlerRef.current?.(current);
				setCurrent({ current, request });
			} else {
				setErr(err);
			}
		}).finally(() => setLoading(i => i-1));
	}, [doThrow, route]);
	useEffect(() => {
		if (initRequest != undefined) {
			call(...(initRequest == true ? [] : [initRequest]) as APIRequest<T>);
		}
	}, [call, initRequest, route]);
	useEffect(() => {
		if (err instanceof Error) throw err;
	}, [err]);
	const reset = useCallback(() => {
		setErr(null);
		setCurrent({ current: null, request: null });
	}, []);
	return useMemo(() => ({ ...current, loading: loading > 0, call, reset } as const), [
		call,
		current,
		loading,
		reset,
	]);
}

class FeedAbortError extends Error {}
export function useFeed<T extends keyof FeedAPI>(
	route: T,
	onUpdate: (x: FeedAPI[T]["response"]) => void,
	...params: APIRequestBase<T>
) {
	const onUpdateRef = useRef(onUpdate);
	useEffect(() => {
		onUpdateRef.current = onUpdate;
	}, [onUpdate]);
	const [signal, setSignal] = useState<AbortSignal | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		setSignal(controller.signal);
		return () => {
			controller.abort(new FeedAbortError());
			setSignal(null);
		};
	}, []);
	const async = useAsync(
		useCallback(async () => {
			if (signal == null) return;
			try {
				console.log(`connecting to ${route}`);
				for await (const update of apiClient.feed(route, ...params, signal)) {
					onUpdateRef.current(update as FeedAPI[T]["response"]);
				}
				console.log(`disconnected from ${route}`);
			} catch (e) {
				if (e instanceof FeedAbortError) return;
				throw e;
			}
		}, [params, route, signal]),
		{ propagateError: true },
	);
	useEffect(() => {
		if (signal != null && !async.attempted) async.run();
	}, [async, signal]);
}
