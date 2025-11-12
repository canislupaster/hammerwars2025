import { isDeepStrictEqual } from "node:util";
import { Queue } from "../shared/queue";
import { ContestProperties, delay, DOMJudgeActiveContest, getTeamLogoURL, handleNDJSONResponse,
	Scoreboard, ScoreboardLastSubmission, ScoreboardTeam, throttle } from "../shared/util";
import { EventEmitter, getDb, getProperty, Mutable, propertiesChanged, transaction } from "./db";
import { Account, BaseNotification, Judgement, Language, Notification, Problem, Submission,
	Team } from "./domjudge_types";
import { env } from "./env";

function relTimeToMs(relTime: string) {
	const m = relTime.match(/^(?<neg>-)?(?<hr>\d+):(?<min>\d{2}):(?<sec>\d{2})(?:\.(?<ms>\d{3}))?$/);
	if (!m) throw new Error("Invalid RELTIME");
	const groups = m.groups ?? {};
	let out = Number.parseInt(groups["hr"]);
	out = 60*out+Number.parseInt(groups["min"]);
	out = 60*out+Number.parseInt(groups["sec"]);
	out = 1000*out+Number.parseInt(groups["ms"]);
	if (groups["neg"] != undefined) out *= -1;
	return out;
}

function cmpTeam(a: ScoreboardTeam, b: ScoreboardTeam) {
	return a.solves != b.solves ? b.solves-a.solves : a.penaltyMinutes-b.penaltyMinutes;
}

function rerank(scoreboard: Scoreboard): Scoreboard {
	const sortedTeams = [...scoreboard.teams.entries()].sort((a, b) => cmpTeam(a[1], b[1]));

	let rank = 1;
	const rankedTeams = new Map(sortedTeams.map(([k, v], i) => {
		if (i > 0 && cmpTeam(sortedTeams[i-1][1], v) < 0) rank++;
		return [k, { ...v, rank }] as const;
	}));

	return { ...scoreboard, teams: new Map(rankedTeams) };
}

function updateMapFromNotification<T extends { id: string }>(
	m: Map<string, T>,
	notif: BaseNotification<string, T>,
) {
	if (notif.id != null) {
		if (notif.data == null) m.delete(notif.id);
		else m.set(notif.id, notif.data);
	} else {
		m.clear();
		notif.data.forEach(x => m.set(x.id, x));
	}
}

type DOMJudgeData = {
	problemInfo: Map<string, Problem>;
	judgements: Map<string, Judgement>;
	languages: Map<string, Language>;
	submission: Map<string, Submission>;
	teams: Map<string, Team>;
	accounts: Map<string, Account>;
	lastUpdate: string | null;
	domJudgeIdToId: Map<string, number>;
	doUpdateTeams: boolean;
	resolveIndex: ContestProperties["resolveIndex"];
	lastJudgementByProblemTeam: Map<string, Map<number, string>>;
};

const makeDomJudgeData = (): DOMJudgeData => ({
	problemInfo: new Map<string, Problem>(),
	judgements: new Map<string, Judgement>(),
	submission: new Map<string, Submission>(),
	languages: new Map<string, Language>(),
	teams: new Map<string, Team>(),
	accounts: new Map<string, Account>(),
	domJudgeIdToId: new Map<string, number>(),
	lastUpdate: null,
	doUpdateTeams: false,
	resolveIndex: null,
	lastJudgementByProblemTeam: new Map(),
});

const defaultScoreboard: Scoreboard = {
	teams: new Map(),
	problemNames: new Map(),
	resolvingState: { type: "unresolved" },
	focusTeamId: null,
};

class PollAbortError extends Error {}

export class DOMJudge extends DisposableStack {
	activeContest = new Mutable<DOMJudgeActiveContest>(null);
	scoreboard = new Mutable<Scoreboard>(defaultScoreboard);

	#relevantProperties = new Set<keyof ContestProperties>([
		"domJudgeCid",
		"resolveIndex",
		"focusTeamId",
	]);
	#relevantPropertiesChanged = new EventEmitter<void>();
	#throttle: ReturnType<typeof throttle>;
	#data = makeDomJudgeData();

	constructor() {
		super();
		this.#throttle = this.use(throttle(500));
		propertiesChanged.on(x => {
			if (this.#relevantProperties.has(x.k)) this.#relevantPropertiesChanged.emit();
		});
	}

	domJudgeApi(url: string, params: Record<string, string | undefined> = {}, abort?: AbortSignal) {
		const authHeader = `Basic ${
			Buffer.from(`${env.DOMJUDGE_API_USER}:${env.DOMJUDGE_API_KEY}`).toString("base64")
		}`;
		const u = new URL(url, new URL(`/api/v4/contests/${this.#domJudgeCid}/`, env.DOMJUDGE_URL));
		for (const [k, v] of Object.entries(params)) {
			if (v != undefined) u.searchParams.append(k, v);
		}
		return fetch(u, {
			headers: { accept: "application/json", authorization: authHeader },
			signal: abort,
		});
	}

	getTeamUsername(domJudgeId: string) {
		return this.#data.accounts.values().find(x => x.team_id == domJudgeId)?.username ?? null;
	}

	#updateJudgements(scoreboard: Scoreboard): Scoreboard {
		this.#data.lastJudgementByProblemTeam.clear();

		type MutTeam = Omit<ScoreboardTeam, "problems"> & {
			problems: Map<string, ScoreboardLastSubmission>;
			penaltyMinutes: number;
			solves: number;
		};
		const newTeams = new Map(
			scoreboard.teams.entries().map((
				[k, v],
			): [number, MutTeam] => [k, { ...v, problems: new Map(), penaltyMinutes: 0, solves: 0 }]),
		);

		const curJudgements = [...this.#data.judgements.values()].map(j => {
			const sub = this.#data.submission.get(j.submission_id);
			if (!sub) return null;

			const prob = this.#data.problemInfo.get(sub.problem_id);
			if (!prob) {
				// problem removed from contest...
				return null;
			}

			const id = this.#data.domJudgeIdToId.get(sub.team_id);
			if (id == null) return null;

			return {
				teamId: id,
				prob,
				id: j.id,
				time: Date.parse(sub.time),
				ac: j.judgement_type_id == null ? null : (j.judgement_type_id == "AC"),
				verdict: j.judgement_type_id,
			};
		}).filter(v => v != null).sort((a, b) => a.time-b.time);

		type J = typeof curJudgements[number];
		const preFreeze: J[] = [], postFreeze: J[] = [];
		for (const j of curJudgements) {
			const beforeFreeze = scoreboard.freezeTimeMs == undefined || j.time < scoreboard.freezeTimeMs;
			(beforeFreeze ? preFreeze : postFreeze).push(j);
		}

		const problemsFirstSolved = new Set<string>();
		const applyJudgement = (team: MutTeam, judgement: J) => {
			const old = team.problems.get(judgement.prob.label);

			if (old?.ac != true || (old?.ac == true && judgement.ac == true)) {
				let m = this.#data.lastJudgementByProblemTeam.get(judgement.prob.label);
				if (m == null) {
					m = new Map();
					this.#data.lastJudgementByProblemTeam.set(judgement.prob.label, m);
				}
				m.set(judgement.teamId, judgement.id);
			}

			if (old?.ac == true) return null;

			const incorrect = (old?.incorrect ?? 0)+(judgement.ac == false ? 1 : 0);
			const penaltyMs = judgement.ac != true
				? 0
				: (scoreboard.startTimeMs == undefined
					? 0
					: Math.max(
						0,
						judgement.time-scoreboard.startTimeMs,
					))+(scoreboard.penaltyTimeMs == undefined ? 0 : scoreboard.penaltyTimeMs*incorrect);

			const sub: ScoreboardLastSubmission = {
				ac: judgement.ac,
				verdict: judgement.verdict ?? null,
				incorrect,
				submissionTimeMs: judgement.time,
				penaltyMinutes: Math.floor(penaltyMs/1000/60),
				first: judgement.ac == true && !problemsFirstSolved.has(judgement.prob.label),
			};

			team.problems.set(judgement.prob.label, sub);
			if (sub.first) problemsFirstSolved.add(judgement.prob.label);

			team.penaltyMinutes += sub.penaltyMinutes;
			team.solves += sub.ac == true ? 1 : 0;

			return sub;
		};

		for (const judgement of preFreeze) {
			const team = newTeams.get(judgement.teamId);
			if (team == null) continue;
			applyJudgement(team, judgement);
		}

		// needs to be widened, fuck u typescript
		let resolvingState: Scoreboard["resolvingState"] = {
			type: "unresolved",
		} as Scoreboard["resolvingState"];

		const i = this.#data.resolveIndex;
		if (i != null && (i.type != "index" || i.index > 0)) {
			let curIndex = 0;
			let hitProblem = false, afterProblem = false;

			const updateResolving = (
				s: Omit<Scoreboard["resolvingState"] & { type: "resolving" }, "index" | "type">,
			) => {
				if (i.type == "problem") {
					if (i.team == s.team && i.prob == s.problem && s.sub?.ac != true) hitProblem = true;
					else if (hitProblem) afterProblem = true;
					if (!i.forward && hitProblem) return true;
					resolvingState = { ...s, type: "resolving", index: ++curIndex };
					return i.forward && afterProblem;
				} else if (i.type == "index") {
					resolvingState = { ...s, type: "resolving", index: ++curIndex };
					return curIndex >= i.index;
				} else {
					i satisfies never;
					return true;
				}
			};

			const teamQueue = new Queue<[number, MutTeam]>((a, b) => {
				const v = cmpTeam(a[1], b[1]);
				return v != 0 ? v > 0 : a[0] > b[0];
			});
			for (const t of newTeams) teamQueue.push(t);

			const postFreezeByTeam = new Map<number, J[]>();
			postFreeze.sort((a, b) =>
				a.prob.label < b.prob.label ? -1 : a.prob.label > b.prob.label ? 1 : 0
			);
			for (const j of postFreeze) {
				const a = postFreezeByTeam.get(j.teamId);
				if (a != undefined) a.push(j);
				else postFreezeByTeam.set(j.teamId, [j]);
			}

			let lastResolvedTeam: number | null = null;
			while (teamQueue.size() > 0) {
				const [id, t] = teamQueue.pop();

				const js = postFreezeByTeam.get(id);
				if (js == undefined || js.length == 0) {
					lastResolvedTeam = id;
					if (updateResolving({ team: id, problem: null, sub: null, lastResolvedTeam })) break;
					continue;
				}

				const prob = js[js.length-1].prob.label;
				const old = t.problems.get(prob);
				if (old?.ac != true) {
					if (updateResolving({ team: id, problem: prob, sub: null, lastResolvedTeam })) break;
					if (
						updateResolving({
							team: id,
							problem: prob,
							sub: applyJudgement(t, js[js.length-1]),
							lastResolvedTeam,
						})
					) break;
				}

				js.pop();
				teamQueue.push([id, t]);
			}

			if (teamQueue.size() == 0 && i.type == "index" && curIndex+1 <= i.index) {
				resolvingState = { type: "resolved", index: curIndex+1 };
			}
		}

		return { ...scoreboard, teams: newTeams, resolvingState };
	}

	// premature as hell
	// but also kind of sanity preserving, bc otherwise this seems a little weird
	// it just feels wrong to do all this shit every time someone e.g. changes
	// their team name with zero protection
	async #reallyUpdateTeams(sc: Scoreboard) {
		const newScoreboard = await transaction(async trx => {
			this.#data.domJudgeIdToId.clear();
			const proms = [...this.#data.teams.values()].map(async team => {
				const data = await trx.selectFrom("team").select(["id", "name"]).where(
					"domJudgeId",
					"=",
					team.id,
				).executeTakeFirst();
				if (data == undefined) return null;

				const logoId = await trx.selectFrom("teamLogo").select("id").where("team", "=", data.id)
					.executeTakeFirst();

				const members = await trx.selectFrom("user").select("id").where("team", "=", data.id)
					.execute();
				const mems = (await Promise.all(members.map(async mem => {
					return (await getDb(trx, "user", mem.id));
				}))).filter(x => x != null);

				if (mems.some(v => v.data.info.inPerson == null)) return null;

				this.#data.domJudgeIdToId.set(team.id, data.id);
				return [data.id, {
					rank: 0,
					solves: 0,
					penaltyMinutes: 0,
					problems: new Map(),
					members: mems.map(v => v.data.info.name).filter(x => x != null),
					name: data.name,
					logo: logoId != null ? getTeamLogoURL(logoId.id) : null,
				}] as const;
			});

			return { ...sc, teams: new Map((await Promise.all(proms)).filter(x => x != null)) };
		});

		return newScoreboard;
	}

	updateTeams() {
		this.#throttle.call(() => {
			this.#data.doUpdateTeams = true;
		});
	}

	#domJudgeCid: string | null = null;
	async #poll() {
		const [cid, resolveIndex, focusTeamId] = await transaction(
			async trx => [
				await getProperty(trx, "domJudgeCid"),
				await getProperty(trx, "resolveIndex"),
				await getProperty(trx, "focusTeamId"),
			]
		);

		let sc = this.scoreboard.v;
		if (focusTeamId != sc.focusTeamId) {
			this.scoreboard.v = sc = { ...sc, focusTeamId };
		}

		if (cid != this.#domJudgeCid) {
			this.#domJudgeCid = cid;
			this.#data = makeDomJudgeData();
			sc = defaultScoreboard;
			this.activeContest.v = null;
		}

		let shouldUpdateJudgements = false;
		if (!isDeepStrictEqual(resolveIndex, this.#data.resolveIndex)) {
			this.#data.resolveIndex = resolveIndex;
			shouldUpdateJudgements = true;
		}

		if (this.#domJudgeCid == null) return;

		let stream: AsyncGenerator<string> | null = null;
		// skip fetch if we already have updates requested...
		// uh makes resolver faster
		if (!shouldUpdateJudgements && !this.#data.doUpdateTeams) {
			const abort = new AbortController();
			const listener = this.#relevantPropertiesChanged.on(() => abort.abort(new PollAbortError()));
			try {
				const res = await this.domJudgeApi("event-feed?stream=false", {
					types: [
						"contests",
						"problems",
						"state",
						"accounts",
						"teams",
						"submissions",
						"judgements",
						"languages",
					].join(","),
					since_token: this.#data.lastUpdate != null ? this.#data.lastUpdate : undefined,
				}, abort.signal);
				if (!res.ok) {
					throw new Error(`domjudge event feed status ${res.status}: ${res.statusText}`);
				}

				stream = handleNDJSONResponse(res);
			} catch (e) {
				if (e instanceof PollAbortError) {
					await this.#poll();
					return;
				}
				throw e;
			} finally {
				listener[Symbol.dispose]();
			}
		}

		for await (const data of stream ?? []) {
			const notif = JSON.parse(data) as Notification;

			if (notif.type == "contest") {
				const penaltyTimeMs = notif.data.penalty_time*60*1000;
				const startTimeMs = notif.data.start_time != null
					? Date.parse(notif.data.start_time)
					: undefined;
				const endTimeMs = startTimeMs == undefined
					? undefined
					: startTimeMs+relTimeToMs(notif.data.duration);
				sc = {
					...sc,
					contestName: notif.data.formal_name ?? undefined,
					penaltyTimeMs,
					startTimeMs,
					endTimeMs,
					freezeTimeMs: endTimeMs == undefined || notif.data.scoreboard_freeze_duration == null
						? undefined
						: endTimeMs-relTimeToMs(notif.data.scoreboard_freeze_duration),
				};
			} else if (notif.type == "problems") {
				updateMapFromNotification(this.#data.problemInfo, notif);
				sc = {
					...sc,
					problemNames: new Map([...this.#data.problemInfo.values()].map(v => [v.label, v.name])),
				};
				shouldUpdateJudgements = true;
			} else if (notif.type == "state") {
				const active = notif.data.ended == null && notif.data.started != null;
				this.activeContest.v = active ? { cid: this.#domJudgeCid, name: sc.contestName } : null;
			} else if (notif.type == "accounts") {
				updateMapFromNotification(this.#data.accounts, notif);
			} else if (notif.type == "teams") {
				updateMapFromNotification(this.#data.teams, notif);
				this.updateTeams();
			} else if (notif.type == "submissions") {
				updateMapFromNotification(this.#data.submission, notif);
				shouldUpdateJudgements = true;
			} else if (notif.type == "judgements") {
				updateMapFromNotification(this.#data.judgements, notif);
				shouldUpdateJudgements = true;
			} else if (notif.type == "languages") {
				updateMapFromNotification(this.#data.languages, notif);
			}

			if (notif.token != undefined) this.#data.lastUpdate = notif.token;
		}

		if (this.#data.doUpdateTeams) {
			sc = await this.#reallyUpdateTeams(sc);
			this.#data.doUpdateTeams = false;
			shouldUpdateJudgements = true;
		}
		if (shouldUpdateJudgements) sc = this.#updateJudgements(sc);
		if (sc != this.scoreboard.v) {
			this.scoreboard.v = rerank(sc);
		}
	}

	async #getSubmissionSource(id: string) {
		return (await (await this.domJudgeApi(`submissions/${id}/source-code`)).json() as {
			filename: string;
			source: string;
		}[]).map(v => ({ ...v, source: Buffer.from(v.source, "base64").toString("utf-8") }));
	}

	async getPreFreezeSolutions() {
		const verdicts = new Map<number, Map<string, number>>();
		const problemSubmissions = new Map<string, { timeFraction: number; ac: boolean }[]>();
		const subJudgements = Map.groupBy(this.#data.judgements.values(), j => j.submission_id);
		const freeze = this.scoreboard.v.freezeTimeMs;

		type Solution = {
			team: number;
			problem: string;
			tl: number;
			name: string;
			languageName: string;
			source: string;
			contestTime: number;
			runtime: number | null;
		};

		const contestStart = this.scoreboard.v.startTimeMs;
		const end = freeze ?? this.scoreboard.v.endTimeMs ?? Date.now();
		const byTeamProblem = new Map<number, Map<string, Solution>>();

		for (const v of this.#data.submission.values()) {
			const team = this.#data.domJudgeIdToId.get(v.team_id);
			const prob = this.#data.problemInfo.get(v.problem_id);
			const lang = this.#data.languages.get(v.language_id);
			const judgement = subJudgements.get(v.id)?.[0];
			const timeMs = Date.parse(v.time);
			if (
				team == null || prob == null || judgement == null || lang == null
				|| judgement.end_time == null
				|| (freeze != null && timeMs >= freeze)
			) continue;

			const code = await this.#getSubmissionSource(v.id);
			if (code.length == 0) continue;

			if (judgement.judgement_type_id != null) {
				const m = verdicts.get(team) ?? new Map<string, number>();
				m.set(judgement.judgement_type_id, (m.get(judgement.judgement_type_id) ?? 0)+1);
				verdicts.set(team, m);

				if (contestStart != null) {
					const subs = problemSubmissions.get(prob.label) ?? [];
					subs.push({
						timeFraction: (timeMs-contestStart)/(end-contestStart),
						ac: judgement.judgement_type_id == "AC",
					});
					problemSubmissions.set(prob.label, subs);
				}
			}

			if (judgement.judgement_type_id == "AC") {
				const m = byTeamProblem.get(team) ?? new Map<string, Solution>();
				const old = m.get(prob.label);
				const contestTime = relTimeToMs(v.contest_time);
				if (old == null || old.contestTime < contestTime) {
					m.set(prob.label, {
						team,
						problem: prob.label,
						tl: prob.time_limit,
						source: code[0].source,
						name: code[0].filename,
						languageName: lang.name,
						contestTime,
						runtime: judgement.max_run_time ?? null,
					});
				}

				byTeamProblem.set(team, m);
			}
		}

		return [
			[...byTeamProblem.values().flatMap(v => v.values())],
			verdicts,
			problemSubmissions,
		] as const;
	}

	async getPublicSubmissionSource(team: number, problemLabel: string) {
		const judgeId = this.#data.lastJudgementByProblemTeam.get(problemLabel)?.get(team);
		const judgement = this.#data.judgements.get(judgeId ?? "");
		const langId = this.#data.submission.get(judgement?.submission_id ?? "")?.language_id;
		if (
			judgeId == null || judgement == null || langId == null || this.scoreboard.v.endTimeMs == null
			|| Date.now() <= this.scoreboard.v.endTimeMs
		) {
			throw new Error("Submission does not exist");
		}
		const language = this.#data.languages.get(langId)?.name;
		const res = await this.#getSubmissionSource(judgement.submission_id);
		if (res.length == 0 || language == null) {
			throw new Error("No source or language found for submission");
		}
		return { ...res[0], language, runtime: judgement.max_run_time ?? null };
	}

	start() {
		let stop = false;
		this.defer(() => {
			stop = true;
		});
		void (async () => {
			while (!stop) {
				const abort = new AbortController();
				try {
					await this.#poll();
					await Promise.race([
						delay(300, abort.signal),
						this.#relevantPropertiesChanged.wait(abort.signal),
					]);
				} catch (e) {
					console.error("domjudge listener error", e);
					await delay(1000);
				} finally {
					abort.abort();
				}
			}
		})();
	}
}

export const domJudge = new DOMJudge();
domJudge.start();
