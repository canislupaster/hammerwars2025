import { Queue } from "../shared/queue";
import { delay, DOMJudgeActiveContest, getTeamLogoURL, handleNDJSONResponse, Scoreboard,
	ScoreboardLastSubmission, ScoreboardTeam, throttle } from "../shared/util";
import { getDbCheck, getProperty, Mutable, propertiesChanged, transaction } from "./db";
import { Account, BaseNotification, Judgement, Notification, Problem, Submission,
	Team } from "./domjudge_types";
import { env } from "./main";

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

function rescore(scoreboard: Scoreboard): Scoreboard {
	const problemFirstTeam = new Map<string, [number, number]>();
	const newTeams = [...scoreboard.teams.entries()].map(([k, v]) => {
		const newProblems = [...v.problems.entries()].map(([k2, v2]) => {
			const penaltyMs = v2.ac != true
				? 0
				: (scoreboard.startTimeMs == undefined
					? 0
					: (v2.submissionTimeMs-scoreboard.startTimeMs))+(scoreboard.penaltyTimeMs == undefined
						? 0
						: scoreboard.penaltyTimeMs*v2.incorrect);

			if (v2.ac == true) {
				const firstTeam = problemFirstTeam.get(k2) ?? [Infinity, -1];
				if (v2.submissionTimeMs < firstTeam[0]) {
					problemFirstTeam.set(k2, [v2.submissionTimeMs, k]);
				}
			}

			return [k2, { ...v2, penaltyMinutes: Math.floor(penaltyMs/(1000*60)) }] as const;
		});

		const penaltyMinutes = newProblems.reduce((a, b) => a+b[1].penaltyMinutes, 0);
		const solves = newProblems.reduce((a, b) => a+(b[1].ac == true ? 1 : 0), 0);
		return [k, { ...v, problems: new Map(newProblems), penaltyMinutes, solves }] as const;
	}).sort((a, b) => cmpTeam(a[1], b[1]));

	const rankedTeams = new Map(newTeams.map(([k, v], i) => {
		return [k, {
			...v,
			rank: i == 0 ? 1 : newTeams[i-1][1].rank+(cmpTeam(newTeams[i-1][1], v) < 0 ? 1 : 0),
			problems: new Map([...v.problems.entries()].map(([k2, v2]) => {
				return [k2, problemFirstTeam.get(k2)?.[0] == k ? { ...v2, first: true } : v2];
			})),
		}] as const;
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
	submission: Map<string, Submission>;
	teams: Map<string, Team>;
	accounts: Map<string, Account>;
	lastUpdate: string | null;
	domJudgeIdToId: Map<string, number>;
	isActive: boolean;
	doUpdateTeams: boolean;
	resolveIndex: number;
	// flagged after resolve index changes
	shouldUpdateJudgements: boolean;
};

const makeDomJudgeData = (): DOMJudgeData => ({
	problemInfo: new Map<string, Problem>(),
	judgements: new Map<string, Judgement>(),
	submission: new Map<string, Submission>(),
	teams: new Map<string, Team>(),
	accounts: new Map<string, Account>(),
	domJudgeIdToId: new Map<string, number>(),
	isActive: false,
	lastUpdate: null,
	doUpdateTeams: false,
	resolveIndex: 0,
	shouldUpdateJudgements: false,
});

const defaultScoreboard: Scoreboard = {
	teams: new Map(),
	problemNames: new Map(),
	resolvingState: { type: "unresolved" },
};

export class DOMJudge extends DisposableStack {
	activeContest = new Mutable<DOMJudgeActiveContest>(null);
	scoreboard = new Mutable<Scoreboard>(defaultScoreboard);

	#throttle: ReturnType<typeof throttle>;
	#data = makeDomJudgeData();

	constructor() {
		super();
		this.#throttle = this.use(throttle(500));
	}

	getTeamUsername(domJudgeId: string) {
		return this.#data.accounts.values().find(x => x.team_id == domJudgeId)?.username ?? null;
	}

	async #updateJudgements(scoreboard: Scoreboard) {
		this.#data.shouldUpdateJudgements = false;

		const newTeams = new Map(
			scoreboard.teams.entries().map((
				[k, v],
			): [
				number,
				Omit<ScoreboardTeam, "problems"> & { problems: Map<string, ScoreboardLastSubmission> },
			] => [k, { ...v, problems: new Map() }]),
		);

		const curJudgements = [
			...this.#data.judgements.values().filter(x => x.current != false).map(j => {
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
					sub,
					ac: j.end_time == null ? null : (j.judgement_type_id == "AC"),
				};
			}).filter(v => v != null),
		];

		type J = typeof curJudgements[number];
		const preFreeze: J[] = [], postFreeze: J[] = [];
		for (const j of curJudgements) {
			const beforeFreeze = scoreboard.freezeTimeMs == undefined
				|| Date.parse(j.sub.time) < scoreboard.freezeTimeMs;
			(beforeFreeze ? preFreeze : postFreeze).push(j);
		}

		type MutTeam = typeof newTeams extends Map<unknown, infer T> ? T : never;
		const applyJudgement = (team: MutTeam, judgement: J) => {
			const old = team.problems.get(judgement.prob.label);
			if (old?.ac == true) return;
			team.problems.set(judgement.prob.label, {
				ac: judgement.ac,
				incorrect: (old?.incorrect ?? -1)+1,
				submissionTimeMs: Date.parse(judgement.sub.time),
				first: false,
				penaltyMinutes: 0,
			});
		};

		for (const judgement of preFreeze) {
			const team = newTeams.get(judgement.teamId);
			if (team == null) continue;
			applyJudgement(team, judgement);
		}

		let resolvingState: Scoreboard["resolvingState"] = { type: "unresolved" };
		const resolve = this.#data.resolveIndex;
		if (resolve > 0) {
			let resolved = 0;
			const teamQueue = new Queue<[number, MutTeam]>((a, b) => cmpTeam(a[1], b[1]) > 0);
			for (const t of newTeams) teamQueue.push(t);

			const postFreezeByTeam = new Map<number, J[]>();
			for (const j of postFreeze) {
				const a = postFreezeByTeam.get(j.teamId);
				if (a != undefined) a.push(j);
				else postFreezeByTeam.set(j.teamId, [j]);
			}

			while (postFreezeByTeam.size > 0) {
				const [id, t] = teamQueue.pop();
				if (resolvingState.type != "resolving" || resolvingState.team != id) {
					resolvingState = { type: "resolving", team: id, problem: null };
					if (++resolved >= resolve) break;
				}

				const js = postFreezeByTeam.get(id);
				if (js == undefined || js.length == 0) continue;
				resolvingState = { type: "resolving", team: id, problem: js[js.length-1].prob.label };

				if (++resolved >= resolve) break;
				applyJudgement(t, js[js.length-1]);
				if (++resolved >= resolve) break;
				js.pop();

				teamQueue.push([id, t]);
			}

			if (resolved < resolve) resolvingState = { type: "resolved" };
		}

		this.scoreboard.v = rescore({ ...scoreboard, teams: newTeams });
	}

	// premature as hell
	// but also kind of sanity preserving, bc otherwise this seems a little weird
	// it just feels wrong to do all this shit every time someone e.g. changes
	// their team name with zero protection
	async #reallyUpdateTeams() {
		this.#data.doUpdateTeams = false;
		const newScoreboard = await transaction(async trx => {
			this.#data.domJudgeIdToId.clear();
			const proms = [...this.#data.teams.values()].map(async team => {
				const data = await trx.selectFrom("team").select(["id", "name"]).where(
					"domJudgeId",
					"=",
					team.id,
				).executeTakeFirst();
				if (data == undefined) return null;
				this.#data.domJudgeIdToId.set(team.id, data.id);

				const logoId = await trx.selectFrom("teamLogo").select("id").where("team", "=", data.id)
					.executeTakeFirst();

				const members = await trx.selectFrom("user").select("id").where("team", "=", data.id)
					.execute();

				return [data.id, {
					rank: 0,
					solves: 0,
					penaltyMinutes: 0,
					problems: new Map(),
					members: (await Promise.all(members.map(async mem => {
						return (await getDbCheck(trx, "user", mem.id)).data.submitted?.name;
					}))).filter(x => x != null),
					name: data.name,
					logo: logoId != null ? getTeamLogoURL(logoId.id) : null,
				}] as const;
			});

			return {
				...this.scoreboard.v,
				teams: new Map((await Promise.all(proms)).filter(x => x != null)),
			};
		});

		await this.#updateJudgements(newScoreboard);
	}

	updateTeams() {
		this.#throttle.call(() => {
			this.#data.doUpdateTeams = true;
		});
	}

	#domJudgeCid: string | null = null;
	async #poll() {
		const [cid, resolveIndex] = await transaction(
			async trx => [
				await getProperty(trx, "domJudgeCid"),
				await getProperty(trx, "resolveIndex") ?? 0,
			]
		);

		if (cid != this.#domJudgeCid) {
			this.#domJudgeCid = cid;
			this.#data = makeDomJudgeData();
			this.scoreboard.v = defaultScoreboard;
			this.activeContest.v = null;
		}

		if (resolveIndex != this.#data.resolveIndex) {
			this.#data.resolveIndex = resolveIndex;
			this.#data.shouldUpdateJudgements = true;
		}

		if (this.#domJudgeCid == null) return;

		const authHeader = `Basic ${
			Buffer.from(`${env.DOMJUDGE_API_USER}:${env.DOMJUDGE_API_KEY}`).toString("base64")
		}`;
		const u = new URL(`api/v4/contests/${cid}/event-feed?stream=false`, env.DOMJUDGE_URL);

		if (this.#data.lastUpdate != null) {
			u.searchParams.append("since_token", this.#data.lastUpdate);
		}

		const res = await fetch(u, {
			headers: { accept: "application/json", authorization: authHeader },
		});
		if (!res.ok) {
			throw new Error(`domjudge event feed status ${res.status}: ${res.statusText}`);
		}

		const stream = handleNDJSONResponse(res);
		for await (const data of stream) {
			const notif = data as Notification;

			if (notif.type == "contest") {
				const penaltyTimeMs = notif.data.penalty_time*60*1000;
				const startTimeMs = notif.data.start_time != null
					? Date.parse(notif.data.start_time)
					: undefined;
				const endTimeMs = startTimeMs == undefined
					? undefined
					: startTimeMs+relTimeToMs(notif.data.duration);
				this.scoreboard.v = rescore({
					...this.scoreboard.v,
					contestName: notif.data.formal_name ?? undefined,
					penaltyTimeMs,
					startTimeMs,
					endTimeMs,
					freezeTimeMs: endTimeMs == undefined || notif.data.scoreboard_freeze_duration == null
						? undefined
						: endTimeMs-relTimeToMs(notif.data.scoreboard_freeze_duration),
				});
			} else if (notif.type == "problems") {
				updateMapFromNotification(this.#data.problemInfo, notif);
				await this.#updateJudgements({
					...this.scoreboard.v,
					problemNames: new Map([...this.#data.problemInfo.values()].map(v => [v.label, v.name])),
				});
			} else if (notif.type == "state") {
				const active = notif.data.ended == null && notif.data.started != null;
				this.activeContest.v = active
					? { cid: this.#domJudgeCid, name: this.scoreboard.v.contestName }
					: null;
			} else if (notif.type == "accounts") {
				updateMapFromNotification(this.#data.accounts, notif);
			} else if (notif.type == "teams") {
				updateMapFromNotification(this.#data.teams, notif);
				this.updateTeams();
			} else if (notif.type == "submissions") {
				updateMapFromNotification(this.#data.submission, notif);
				await this.#updateJudgements(this.scoreboard.v);
			} else if (notif.type == "judgements") {
				updateMapFromNotification(this.#data.judgements, notif);
				await this.#updateJudgements(this.scoreboard.v);
			}

			if (notif.token != undefined) this.#data.lastUpdate = notif.token;
		}

		if (this.#data.doUpdateTeams) await this.#reallyUpdateTeams();
		if (this.#data.shouldUpdateJudgements) await this.#updateJudgements(this.scoreboard.v);
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
					await Promise.race([delay(200, abort.signal), propertiesChanged.wait(abort.signal)]);
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
