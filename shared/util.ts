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
export type TeamData = { name: string };
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

type Session = { id: number; key: string };

export type API = {
	register: { request: { email: string }; response: "sent" | "alreadySent" };
	login: { request: { email: string; password: string }; response: Session | "incorrect" };
	checkEmailVerify: { request: { id: number; email: string; key: string }; response: boolean };
	createAccount: {
		request: { id: number; email: string; key: string; password: string };
		response: Session;
	};
	setPassword: { auth: true; request: { newPassword: string } };
	updateInfo: { auth: true; request: { id: number; info: UserInfo; submit: boolean } };
	deleteUser: { auth: true };
	// like yeah base64 is not ideal but saves me time
	setTeam: { auth: true; name: string; logo: string };
	joinTeam: { auth: true; joinCode: string };
	leaveTeam: { auth: true };
};

export type ServerResponse<K extends keyof API> =
	| (API[K] extends { auth: true } ? { type: "needLogin" } : never)
	| { type: "internalError"; message: string }
	| {
		type: "ok";
		data: API[K] extends { response: unknown } ? API[K]["response"] : null;
	};
