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
export type TeamData = { name: string; inPerson: boolean };
export type UserInfo = { name: string; email: string; discord: string };
export type UserData = { info: Partial<UserInfo>; submitted: UserInfo | null; lastEdited: number };

export type ContestProperties = {
	registrationEnds: number;
	registrationOpen: boolean;
	internetAccessAllowed: boolean;
};

export type API = {};

export type ServerResponse<K extends keyof API> = { type: "error"; message: string } | {
	type: "ok";
	data: API[K] extends { response: unknown } ? API[K]["response"] : null;
};
