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
		return new Array(len).fill(undefined).map((_, i): T => (v as ((idx: number) => T))(i));
	}
	return (new Array<T>(len)).fill(v);
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

// nodejs compatibility
type Timeout = ReturnType<typeof setTimeout>;

export function debounce(ms: number) {
	let ts: Timeout | null = null;
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
	let ts: Timeout | null = null;
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

export const validNameRe = "^[A-Za-z0-9 _\\-]{2,30}$";
export const validFilenameRe = "^[ -.0-\\[\\]-~]{1,100}$";
export const validFullNameRe = "^(?! )[ \\x21-\\x7E\\p{L}\\p{M}\\p{N}\\p{P}]{2,50}(?<! )$";
export const validDiscordRe = "^[A-Za-z0-9._]{2,32}$";
export const maxFactLength = 300;
export const joinCodeRe = "^\\d{10}$";
export const logoMimeTypes = ["image/jpeg", "image/png"] as const;
export const logoMaxSize = 1024*1024*1;
export const resumeMaxSize = 1024*1024*5;
export const teamFilesMaxSize = 1024*1024*10;
export const maxPromptLength = 1024*4;
export const screenshotMaxWidth = 1920;
export const teamLimit = 3;
export const timePlace = "November 16, 2025 in the Lawson Computer Science Building";

export const shirtSizes = ["xs", "s", "m", "l", "xl", "2xl", "3xl", "4xl", "5xl"] as const;

export const feedHeartbeat = 1000, feedTimeout = 2000;

export type UserInfo = {
	name: string;
	discord: string | null;
	shirtSeed: number;
	shirtHue: number;
	inPerson: {
		dinner: "cheese" | "pepperoni" | "sausage" | "none";
		lunch: "ham" | "turkey" | "tuna" | "veggie" | "none";
		shirtSize: (typeof shirtSizes[number]) | "none";
	} | null;
};

export type TeamContestProperties = {
	firewallEnabled: boolean;
	screenshotsEnabled: boolean;
	visibleDirectories: string[];
	loginLocked: boolean;
};

export type DuelLayout = "left" | "both" | "right";

export type PresentationState = Readonly<
	({ type: "none" } | { type: "scoreboard" } | { type: "countdown"; to: number; title: string } | {
		type: "submissions";
		problems: {
			label: string;
			solutions: {
				title: string;
				summary: string;
				language: string;
				source: string;
				team: number;
			}[];
		}[];
	} & Pick<SubmissionRankings, "teamVerdicts" | "verdictTime"> | { type: "live"; src: string } | {
		type: "image";
		src: string;
	} | { type: "video"; src: string; logo?: string } | { type: "duel" }) & {
		liveOverlaySrc?: string;
	}
>;

export type PresentationSlide = Readonly<
	& { noTransition?: boolean }
	& (PresentationState & { type: "countdown" | "none" | "image" | "video" | "scoreboard" | "live" }
		| { scoreboard: Scoreboard; end: number }
			& ({
				type: "submission";
				problemLabel: string;
				data: Readonly<
					(PresentationState & { type: "submissions" })["problems"][number]["solutions"][number]
				>;
			} | { type: "teamVerdicts"; team: number; teamVerdicts: ReadonlyMap<string, number> } | {
				type: "verdictTime";
				problemLabel: string;
				verdictTime: readonly Readonly<{ ac: boolean; timeFraction: number }>[];
			}) | { type: "duel" } & DuelState)
>;

export type SubmissionRankings = {
	problems: {
		label: string;
		solutions: {
			category: string;
			candidates: {
				score: number;
				title: string;
				summary: string;
				language: string;
				source: string;
				team: number;
			}[];
		}[];
	}[];
	teamVerdicts: ReadonlyMap<number, ReadonlyMap<string, number>>;
	verdictTime: ReadonlyMap<string, readonly Readonly<{ timeFraction: number; ac: boolean }>[]>;
};

export type DuelPlayer = { name: string; src?: string; solved: Set<string> };

export type DuelState = {
	layout: DuelLayout;
	problemLabels: string[];
	players: [DuelPlayer, DuelPlayer];
};

export type DuelConfigPlayer = { name: string; cf: string; src?: string };

export type DuelConfig = {
	cfContestId: number;
	layout: DuelLayout;
	players: [DuelConfigPlayer, DuelConfigPlayer];
} | null;

export type ContestProperties = {
	registrationEnds: number | null;
	registrationOpen: boolean;
	onlineRegistrationOpen: boolean;
	registrationOpenEmails: Set<string>;
	domJudgeCid: string;
	// forward: skip until team/prob is over or AC, backward: stop at when team/prob occurs
	resolveIndex: { type: "index"; index: number } | {
		type: "problem";
		forward: boolean;
		team: number;
		prob: string;
	} | null;
	focusTeamId: number | null;
	team: TeamContestProperties;
	organizerTeamId: number | null;
	presentation: { queue: PresentationState[]; current: number };
	duel: DuelConfig;
	live: { name: string; src: string; active: boolean; overlay: boolean }[];
	daemonUpdate: { version: number; source: string } | null;
};

export type Session = { id: number; key: string };
export type PartialUserInfo = Partial<Omit<UserInfo, "inPerson">> & {
	inPerson: Partial<UserInfo["inPerson"]> | null;
	shirtSeed: number;
	shirtHue: number;
	discord: string | null;
	agreeRules: boolean;
};

export type ScoreboardLastSubmission = {
	submissionTimeMs: number;
	penaltyMinutes: number;
	incorrect: number;
	first: boolean;
	ac: boolean | null;
	verdict: string | null;
};

export type ScoreboardTeam = Readonly<
	{
		name: string;
		logo: string | null;
		rank: number;
		solves: number;
		penaltyMinutes: number;
		problems: ReadonlyMap<string, Readonly<ScoreboardLastSubmission>>;
		members: readonly string[];
	}
>;

export function cmpTeamRankId(
	[k1, a]: [number, ScoreboardTeam],
	[k2, b]: [number, ScoreboardTeam],
) {
	return a.rank != b.rank ? a.rank-b.rank : k1-k2;
}

export type Scoreboard = Readonly<
	{
		contestName?: string;
		teams: ReadonlyMap<number, ScoreboardTeam>;
		problemNames: ReadonlyMap<string, string>;
		startTimeMs?: number;
		freezeTimeMs?: number;
		endTimeMs?: number;
		penaltyTimeMs?: number;
		focusTeamId: number | null;
		resolvingState: Readonly<
			{ type: "resolved"; index: number } | {
				type: "resolving";
				team: number;
				problem: string | null;
				sub: ScoreboardLastSubmission | null;
				lastResolvedTeam: number | null;
				index: number;
			} | { type: "unresolved" }
		>;
	}
>;

export type AdminTeamData = {
	id: number;
	name: string;
	domJudgeId: string | null;
	domJudgePassword: string | null;
	printerName: string | null;
	unregisterMachineTimeMs: number | null;
	joinCode: string;
	logoId: number | null;
};

export type AdminUserData = {
	id: number;
	email: string;
	lastEdited: number;
	submitted: UserInfo | null;
	info: PartialUserInfo;
	pairUp: boolean | null;
	emailKey: { id: number; key: string } | null;
	team: number | null;
	confirmedAttendanceTime: number | null;
	resumeId: number | null;
};

export type DOMJudgeActiveContest = { cid: string; name?: string } | null;

export type API = {
	register: { request: { email: string }; response: "sent" | "alreadySent" };
	login: { request: { email: string; password: string }; response: "incorrect" | null };
	checkEmailVerify: { request: { id: number; key: string }; response: boolean };
	createAccount: { request: { id: number; key: string; password: string | null } };
	registrationWindow: {
		response: { inPersonOpen: boolean; inPersonCloses: number | null; onlineOpen: boolean };
	};
	checkSession: unknown;
	setPassword: { request: { newPassword: string } };
	getInfo: {
		response: {
			info: PartialUserInfo;
			organizer: boolean;
			submitted: boolean;
			lastEdited: number;
			confirmedAttendance: boolean;
			pairUp: boolean;
			team: {
				id: number;
				name: string;
				logo: string | null;
				funFact: string | null;
				joinCode: string;
				members: { name: string | null; email: string; id: number; inPerson: boolean | null }[];
				files: { name: string; size: number }[];
			} | null;
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
			funFact: string | null;
			logo?: { base64: string; mime: typeof logoMimeTypes[number] } | "remove";
			files?: { name: string; base64: string }[] | "remove";
		};
	};
	joinTeam: { request: { joinCode: string }; response: { full: boolean } };
	leaveTeam: unknown;
	confirmAttendance: { request: { pairUp: boolean } };
	getProperties: { response: Partial<ContestProperties> };
	setProperties: { request: Partial<ContestProperties> };
	announce: { request: { teams: number[] | "allTeams"; title: string; body: string } };
	getResumeId: { request: { id: number }; response: { base64: string } };
	getTeamLogo: { request: { id: number }; response: { base64: string; mime: string } };
	getTeamFunFact: { request: { id: number }; response: string };
	allData: { response: { users: AdminUserData[]; teams: AdminTeamData[] } };
	setUsers: {
		request:
			(Omit<
				AdminUserData,
				"emailKey" | "pairUp" | "resumeId" | "info" | "lastEdited" | "confirmedAttendanceTime"
			> | { id: number; delete: true })[];
	};
	setTeams: { request: (Omit<AdminTeamData, "logoId"> | { id: number; delete: true })[] };
	teamInfo: { request: { id: number }; response: AdminTeamData };
	getTeamFile: { request: { id: number }; response: { name: string; base64: string } };
	teamFeed: {
		request: { id: number };
		feed: true;
		response: {
			type: "update";
			state: {
				domJudgeCredentials: { user: string; pass: string } | null;
				domJudgeActiveContest: DOMJudgeActiveContest;
				teamProperties: TeamContestProperties;
				lastAnnouncementId: number | null;
				daemonVersion: number | null;
				printerName: string | null;
				teamFiles: number[];
				unregisterMachineTimeMs: number | null;
			};
		};
	};
	getDaemonSource: { response: { version: number; source: string } | null };
	getAnnouncement: {
		request: { team: number; afterId: number | null };
		response: { id: number; title: string; body: string; time: number } | null;
	};
	getSubmission: {
		request: { team: number; problem: string };
		response: { filename: string; source: string; language: string; runtime: number | null };
	};
	getScoreboard: { response: Scoreboard };
	scoreboard: { feed: true; response: Scoreboard };
	presentation: {
		feed: true;
		request: { live: boolean };
		response: { type: "slide"; slide: PresentationSlide } | {
			type: "overlay";
			overlaySrc: string | null;
		} | { type: "live"; srcs: string[] };
	};
	screenshot: { request: { team: number; data: string; mac: string } };
	getPreFreezeSolutions: {
		request: { label: string; intendedSolution: string }[];
		response: SubmissionRankings;
	};
	getPresentationQueue: {
		response: ContestProperties["presentation"] & {
			live: ContestProperties["live"];
			duel: ContestProperties["duel"];
		};
	};
};

export type ServerResponse<K extends keyof API> = { type: "error"; error: APIErrorObject } | {
	type: "ok";
	data: API[K] extends { response: unknown } ? API[K]["response"] : null;
	session?: Session | "clear";
};

export type APIRequestBase<T extends keyof API> = API[T] extends { request: unknown }
	? [data: API[T]["request"]]
	: [];

export type APIRequest<T extends keyof API> = APIRequestBase<T> | [
	...APIRequestBase<T>,
	abort: AbortSignal,
];

type IsNonFeedAPI<K extends keyof API> = API[K] extends { feed: true } ? never : K;
type IsFeedAPI<K extends keyof API> = API[K] extends { feed: true } ? K : never;
export type NonFeedAPI = { [K in keyof API as IsNonFeedAPI<K>]: API[K] };
export type FeedAPI = { [K in keyof API as IsFeedAPI<K>]: API[K] };

export async function* handleNDJSONResponse(resp: Response, signal?: AbortSignal) {
	const reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
	let abortCb: (() => void) | undefined;
	let abortPromise = new Promise<{ type: "abort"; reason: unknown }>(() => {});
	if (signal) {
		abortPromise = new Promise(res => {
			abortCb = () => res({ type: "abort", reason: signal.reason });
			signal.addEventListener("abort", abortCb);
		});
	}
	try {
		let buf = "", i = 0;
		while (true) {
			const nxt = await Promise.race([
				reader.read().then(v => ({ type: "reader", v } as const)),
				abortPromise,
			]);
			if (nxt.type == "abort") throw nxt.reason;
			const { value, done } = nxt.v;
			if (value != undefined) buf += value;
			while (i < buf.length) {
				if (buf[i++] == "\n") {
					yield buf.slice(0, i-1);
					buf = buf.slice(i);
					i = 0;
				}
			}
			if (done) {
				if (buf.length > 0) yield buf;
				return;
			}
		}
	} finally {
		await reader.cancel();
		if (abortCb != undefined) signal?.removeEventListener("abort", abortCb);
	}
}

// false if aborted
export function delay(ms: number, abort?: AbortSignal): Promise<boolean> {
	return new Promise<boolean>(res => {
		const tm = setTimeout(() => {
			res(true);
			abort?.removeEventListener("abort", cb);
		}, ms);
		const cb = () => {
			clearTimeout(tm);
			abort?.removeEventListener("abort", cb);
			res(false);
		};
		abort?.addEventListener("abort", cb);
	});
}

export const getTeamLogoURL = (logoId: number) => `teamLogo/${logoId}`;

class AbortError extends Error {
	constructor(public timeout: boolean) {
		super();
	}
}

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
		const f = args[0], d = args[args.length-1];
		return await fetch(new URL(k, this.baseUrl), {
			headers: {
				"Content-Type": "application/json",
				...this.auth.apiKey != null
					? { Authorization: `Bearer ${this.auth.apiKey}` }
					: this.auth.session
					? { Authorization: `Basic ${this.auth.session.id} ${this.auth.session.key}` }
					: {},
			},
			signal: d instanceof AbortSignal ? d : undefined,
			body: f != undefined && !(f instanceof AbortSignal) ? stringifyExtra(f) : undefined,
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

	async *#feedNoRetry<T extends keyof FeedAPI>(k: T, ...args: APIRequest<T>) {
		const disp = new DisposableStack();
		try {
			const abort = new AbortController();
			const f = args[args.length-1] as AbortSignal | undefined;
			if (f != undefined && f instanceof AbortSignal) {
				const cb = () => abort.abort(new AbortError(false));
				f.addEventListener("abort", cb);
				disp.defer(() => f.removeEventListener("abort", cb));
			}

			let timeout: Timeout | null = null;
			disp.defer(() => {
				if (timeout != null) clearTimeout(timeout);
			});
			const resetTm = () => {
				if (timeout != null) clearTimeout(timeout);
				timeout = setTimeout(() => abort.abort(new AbortError(true)), feedTimeout);
			};
			resetTm();

			const resp = await this.#fetch(k, ...args);
			if (!resp.ok) throw new Error(`feed ${k} responded with status ${resp.status}`);
			for await (const x of handleNDJSONResponse(resp, abort.signal)) {
				if (x == "") {
					resetTm();
					continue;
				}
				yield this.#handleResp(parseExtra(x) as ServerResponse<T>);
			}

			if (abort.signal.reason instanceof AbortError) {
				throw abort.signal.reason;
			}
		} finally {
			disp.dispose();
		}
	}

	async *feed<T extends keyof FeedAPI>(k: T, ...args: APIRequest<T>) {
		let lastError = -Infinity;
		const threshold = 2*feedTimeout;
		while (true) {
			try {
				for await (const x of this.#feedNoRetry(k, ...args)) yield x;
				return;
			} catch (e) {
				if (e instanceof AbortError) {
					// aborted due to args abort signal
					if (!e.timeout) return;
					if (Date.now()-lastError > threshold) {
						lastError = Date.now();
						continue;
					}
					throw new Error(`Feed ${k} timed out`);
				}
				throw e;
			}
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

export const badHash = (s: string) =>
	[...s].map((x, i) => (x.charCodeAt(0)*13+17*i)%7).reduce((a, b) => a+b, 0);
export const forever = new Promise<never>(() => {});
