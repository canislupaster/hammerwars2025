export type APIErrorObject = {
	type: "internal" | "badRequest" | "needLogin";
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
export const joinCodeRe = "^\\d{10}$";
export const logoMimeTypes = ["image/jpeg", "image/png"] as const;
export const logoMaxSize = 1024*64;

export type UserInfo = {
	name: string;
	discord: string | null;
	inPerson: {
		needTransportation: boolean;
		pizza: "cheese" | "pepperoni" | "sausage" | null;
		sandwich: "veggieWrap" | "spicyChicken" | "chicken" | null;
	} | null;
};

export type ContestProperties = {
	registrationEnds: number;
	registrationOpen: boolean;
	internetAccessAllowed: boolean;
};

export type Session = { id: number; key: string };

export type API = {
	register: { request: { email: string }; response: "sent" | "alreadySent" };
	login: { request: { email: string; password: string }; response: Session | "incorrect" };
	checkEmailVerify: { request: { id: number; key: string }; response: boolean };
	createAccount: { request: { id: number; key: string; password: string }; response: Session };
	checkSession: { auth: true };
	// logs u out
	setPassword: { auth: true; request: { newPassword: string } };
	getInfo: {
		auth: true;
		response: {
			info: Partial<UserInfo>;
			submitted: boolean;
			lastEdited: number;
			team: { name: string; logo: string | null; joinCode: string } | null;
		};
	};
	updateInfo: { auth: true; request: { info: Partial<UserInfo>; submit: boolean } };
	deleteUser: { auth: true };
	// like yeah base64 is not ideal but saves me time
	setTeam: {
		auth: true;
		request: {
			name: string;
			logo: { base64: string; mime: typeof logoMimeTypes[number] } | "remove" | null;
		};
	};
	joinTeam: { auth: true; request: { joinCode: string } };
	leaveTeam: { auth: true };
};

export type ServerResponse<K extends keyof API> = { type: "error"; error: APIErrorObject } | {
	type: "ok";
	data: API[K] extends { response: unknown } ? API[K]["response"] : null;
};
