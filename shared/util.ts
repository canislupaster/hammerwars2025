export type APIErrorObject = {
	type: "internal" | "badRequest" | "needLogin" | "fetch";
	msg: string;
	status: number;
};
export class APIError extends Error {
	constructor(public error: APIErrorObject) {
		super(error.msg);
	}
}

export function fill<T>(len: number, v: T | ((idx: number) => T)): T[] {
	if (typeof v == "function") {
		return [...new Array(len) as unknown[]].map((_, i): T => (v as ((idx: number) => T))(i));
	}
	return [...new Array(len) as unknown[]].map(() => v);
}

export function stringifyExtra(value: unknown) {
	return JSON.stringify(value, (_, v: unknown) => {
		if (v instanceof Map) return { __dtype: "map", value: [...v.entries()] };
		else if (v instanceof Set) return { __dtype: "set", value: [...v.values()] };
		else if (typeof v == "bigint") return { __dtype: "bigint", value: v.toString() };
		return v;
	});
}

export function parseExtra(str: string | null): unknown {
	return str == null ? null : JSON.parse(str, (_, v) => {
		const v2 = v as { __dtype: "set"; value: [unknown][] } | {
			__dtype: "map";
			value: [unknown, unknown][];
		} | { __dtype: "bigint"; value: string } | { __dtype: undefined };
		if (v2 != null && typeof v2 == "object") {
			if (v2.__dtype == "map") return new Map(v2.value);
			else if (v2.__dtype == "set") return new Set(v2.value);
			else if (v2.__dtype == "bigint") return BigInt(v2.value);
		}
		return v2;
	});
}

export const validNameRe = "^[A-Za-z0-9 _\\-]{5,30}$";
export const validDiscordRe = "^[A-Za-z0-9._]{2,32}$";
export const joinCodeRe = "^\\d{10}$";
export const logoMimeTypes = ["image/jpeg", "image/png"] as const;
export const logoMaxSize = 1024*64;
export const resumeMaxSize = 1024*1024*5;
export const maxPromptLength = 1024*4;

export const shirtSizes = ["xs", "s", "m", "l", "xl", "2xl", "3xl", "4xl", "5xl"] as const;

export type UserInfo = {
	name: string;
	discord: string | null;
	inPerson: {
		needTransportation: boolean;
		pizza: "cheese" | "pepperoni" | "sausage" | "none";
		sandwich: "chickenBaconRancher" | "chipotleChickenAvoMelt" | "toastedGardenCaprese"
			| "baconTurkeyBravo" | "none";
		shirtSize: (typeof shirtSizes[number]) | "none";
	} | null;
};

export type ContestProperties = {
	registrationEnds: number;
	registrationOpen: boolean;
	internetAccessAllowed: boolean;
};

export type Session = { id: number; key: string };
export type PartialUserInfo = Partial<Omit<UserInfo, "inPerson">> & {
	inPerson: (Partial<UserInfo["inPerson"]> & { needTransportation: boolean }) | null;
	discord: string | null;
};

export type API = {
	register: { request: { email: string }; response: "sent" | "alreadySent" };
	login: { request: { email: string; password: string }; response: "incorrect" | null };
	checkEmailVerify: { request: { id: number; key: string }; response: boolean };
	createAccount: { request: { id: number; key: string; password: string } };
	registrationWindow: { response: { open: boolean; closes: number | null } };
	checkSession: unknown;
	setPassword: { request: { newPassword: string } };
	getInfo: {
		response: {
			info: PartialUserInfo;
			submitted: boolean;
			lastEdited: number;
			team: { name: string; logo: string | null; joinCode: string } | null;
			hasResume: boolean;
		};
	};
	getResume: { response: string | null };
	updateResume: { request: { type: "add"; base64: string } | { type: "remove" } };
	updateInfo: { request: { info: PartialUserInfo; submit: boolean } };
	generateLogo: { request: { prompt: string } };
	deleteUser: unknown;
	// like yeah base64 is not ideal but saves me time
	setTeam: {
		request: {
			name: string;
			logo: { base64: string; mime: typeof logoMimeTypes[number] } | "remove" | null;
		};
	};
	joinTeam: { request: { joinCode: string } };
	leaveTeam: unknown;
	getProperties: { response: Partial<ContestProperties> };
	setProperties: { request: Partial<ContestProperties> };
};

export type ServerResponse<K extends keyof API> = { type: "error"; error: APIErrorObject } | {
	type: "ok";
	data: API[K] extends { response: unknown } ? API[K]["response"] : null;
	session?: Session | "clear";
};

export type APIRequest<T extends keyof API> = API[T] extends { request: unknown }
	? [API[T]["request"]]
	: [];
export type APIRequestParameters = { [K in keyof API]: [K, ...APIRequest<K>] };

export class APIClient {
	constructor(
		public baseUrl: string,
		public auth: {
			session: Session | null;
			apiKey: string | null;
			onSessionChange?: (x: Session | null) => void;
		},
	) {}

	async request<T extends keyof API>(...args: APIRequestParameters[T]) {
		const resp = await fetch(new URL(args[0], this.baseUrl), {
			headers: {
				"Content-Type": "application/json",
				...this.auth.apiKey != null
					? { Authorization: `Bearer ${this.auth.apiKey}` }
					: this.auth.session
					? { Authorization: `Basic ${this.auth.session.id} ${this.auth.session.key}` }
					: {},
			},
			body: typeof args[1] == "function" ? undefined : stringifyExtra(args[1]),
			credentials: "same-origin",
			method: "POST",
		});

		const data = parseExtra(await resp.text()) as ServerResponse<T>;
		if (data.type == "error") {
			throw new APIError(data.error);
		} else if (data.session != undefined) {
			this.auth.session = data.session == "clear" ? null : data.session;
			this.auth.onSessionChange?.(this.auth.session);
		}
		return data.data;
	}

	logout() {
		this.auth.session = null;
		this.auth.onSessionChange?.(null);
	}
}
