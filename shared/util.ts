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

// awful time complexity lmfao
export function mapWith<K, V>(map: ReadonlyMap<K, V> | null, k: K, v?: V) {
	const newMap = new Map(map);
	if (v !== undefined) newMap.set(k, v);
	else newMap.delete(k);
	return newMap;
}

export function setWith<K>(set: ReadonlySet<K> | null, k: K, del?: boolean) {
	const newSet = new Set(set);
	if (del == true) newSet.delete(k);
	else newSet.add(k);
	return newSet;
}

export function debounce(ms: number) {
	let ts: number | null = null;
	return {
		call(f: () => void) {
			if (ts != null) clearTimeout(ts);
			ts = setTimeout(() => f(), ms);
		},
		cancel() {
			if (ts != null) {
				clearTimeout(ts);
				ts = null;
			}
		},
		[Symbol.dispose]() {
			this.cancel();
		},
	} as const;
}

export function throttle(ms: number, callOnDispose?: boolean) {
	let ts: number | null = null;
	let cur: (() => void) | null = null;
	return {
		call(f: () => void) {
			cur = f;
			if (ts == null) {
				const p = () => {
					cur!();
					cur = null;
					ts = setTimeout(() => {
						if (cur) p();
						else ts = null;
					}, ms);
				};
				p();
			}
		},
		[Symbol.dispose]() {
			if (ts != null) clearTimeout(ts);
			if (cur != null && callOnDispose == true) cur?.();
		},
	} as const;
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
export const logoMaxSize = 1024*1024*1;
export const resumeMaxSize = 1024*1024*5;
export const maxPromptLength = 1024*4;
export const screenshotMaxWidth = 1920;

export const shirtSizes = ["xs", "s", "m", "l", "xl", "2xl", "3xl", "4xl", "5xl"] as const;

export type UserInfo = {
	name: string;
	discord: string | null;
	shirtSeed: number;
	shirtHue: number;
	inPerson: {
		needTransportation: boolean;
		pizza: "cheese" | "pepperoni" | "sausage" | "none";
		sandwich: "chickenBaconRancher" | "chipotleChickenAvoMelt" | "toastedGardenCaprese"
			| "baconTurkeyBravo" | "none";
		shirtSize: (typeof shirtSizes[number]) | "none";
	} | null;
};

export type TeamContestProperties = {
	firewallEnabled: boolean;
	screenshotsEnabled: boolean;
	visibleDirectories: string[];
};

export type ContestProperties = {
	registrationEnds: number;
	registrationOpen: boolean;
	domJudgeCid: string;
	team: TeamContestProperties;
};

export type Session = { id: number; key: string };
export type PartialUserInfo = Partial<Omit<UserInfo, "inPerson">> & {
	inPerson: (Partial<UserInfo["inPerson"]> & { needTransportation: boolean }) | null;
	shirtSeed: number;
	shirtHue: number;
	discord: string | null;
	agreeRules: boolean;
};

export type ScoreboardLastSubmission = {
	submissionTimeMs: number;
	penaltyMinutes: number;
	incorrect: number;
	ac: boolean | null;
};

export type ScoreboardTeam = Readonly<
	{
		name: string;
		logo: string | null;
		rank: number;
		solves: number;
		totalPenaltyMinutes: number;
		problems: ReadonlyMap<string, Readonly<ScoreboardLastSubmission>>;
		members: string[];
	}
>;

export type Scoreboard = Readonly<
	{
		contestName?: string;
		teams: ReadonlyMap<number, ScoreboardTeam>;
		problemNames: ReadonlyMap<string, string>;
		startTimeMs?: number;
		freezeTimeMs?: number;
		endTimeMs?: number;
		penaltyTimeMs?: number;
	}
>;

export type AdminTeamData = {
	id: number;
	name: string;
	domJudgeId: string | null;
	domJudgePassword: string | null;
	joinCode: string;
	logoId: number | null;
};

export type DOMJudgeActiveContest = { cid: string; name?: string } | null;

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
	getResumeId: { request: { id: number }; response: { base64: string } };
	getTeamLogoId: { request: { id: number }; response: { base64: string; mime: string } };
	allData: {
		response: {
			users: {
				id: number;
				email: string;
				data: UserInfo | null;
				team: number | null;
				resumeId: number | null;
			}[];
			teams: AdminTeamData[];
		};
	};
	setTeams: { request: (Omit<AdminTeamData, "logoId"> | { id: number; delete: true })[] };
	teamFeed: {
		request: { id: number };
		feed: true;
		response: {
			type: "update";
			state: {
				domJudgeCredentials: { user: string; pass: string } | null;
				domJudgeActiveContest: DOMJudgeActiveContest;
				teamProperties: TeamContestProperties;
			};
		};
	};
	scoreboard: { feed: true; response: Scoreboard };
	screenshot: { request: { team: number; data: string; mac: string } };
};

export type ServerResponse<K extends keyof API> = { type: "error"; error: APIErrorObject } | {
	type: "ok";
	data: API[K] extends { response: unknown } ? API[K]["response"] : null;
	session?: Session | "clear";
};

export type APIRequest<T extends keyof API> = API[T] extends { request: unknown }
	? [API[T]["request"]]
	: [];

type IsNonFeedAPI<K extends keyof API> = API[K] extends { feed: true } ? never : K;
type IsFeedAPI<K extends keyof API> = API[K] extends { feed: true } ? K : never;
export type NonFeedAPI = { [K in keyof API as IsNonFeedAPI<K>]: API[K] };
export type FeedAPI = { [K in keyof API as IsFeedAPI<K>]: API[K] };

export async function* handleNDJSONResponse(resp: Response) {
	const reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
	try {
		let buf = "", i = 0;
		while (true) {
			const { value, done } = await reader.read();
			if (value != undefined) buf += value;
			while (i < buf.length) {
				if (buf[i++] == "\n") {
					yield parseExtra(buf.slice(0, i-1));
					buf = buf.slice(i);
					i = 0;
				}
			}
			if (done) {
				if (buf.length > 0) yield parseExtra(buf);
				return;
			}
		}
	} finally {
		await reader.cancel();
	}
}

export function delay(ms: number) {
	return new Promise<void>(res => setTimeout(res, ms));
}

export const getTeamLogoURL = (logoId: number) => `teamLogo/${logoId}`;

export class APIClient {
	constructor(
		public baseUrl: string,
		public auth: {
			session: Session | null;
			apiKey: string | null;
			onSessionChange?: (x: Session | null) => void;
		},
	) {}

	async #fetch<T extends keyof API>(k: T, ...args: APIRequest<T>) {
		return await fetch(new URL(k, this.baseUrl), {
			headers: {
				"Content-Type": "application/json",
				...this.auth.apiKey != null
					? { Authorization: `Bearer ${this.auth.apiKey}` }
					: this.auth.session
					? { Authorization: `Basic ${this.auth.session.id} ${this.auth.session.key}` }
					: {},
			},
			body: args.length > 0 ? stringifyExtra(args[0]) : undefined,
			credentials: "same-origin",
			method: "POST",
		});
	}

	#handleResp<T extends keyof API>(data: ServerResponse<T>) {
		if (data.type == "error") {
			throw new APIError(data.error);
		} else if (data.session != undefined) {
			this.auth.session = data.session == "clear" ? null : data.session;
			this.auth.onSessionChange?.(this.auth.session);
		}
		return data.data;
	}

	async *feed<T extends keyof FeedAPI>(k: T, ...args: APIRequest<T>) {
		const resp = await this.#fetch(k, ...args);
		for await (const x of handleNDJSONResponse(resp)) {
			yield this.#handleResp(x as ServerResponse<T>);
		}
	}

	async request<T extends keyof NonFeedAPI>(k: T, ...args: APIRequest<T>) {
		const resp = await this.#fetch(k, ...args);
		const data = parseExtra(await resp.text()) as ServerResponse<T>;
		return this.#handleResp(data);
	}

	logout() {
		this.auth.session = null;
		this.auth.onSessionChange?.(null);
	}
}
