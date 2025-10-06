import { delay, DOMJudgeActiveContest, getTeamLogoURL, handleNDJSONResponse, mapWith, Scoreboard,
	ScoreboardLastSubmission, ScoreboardTeam, throttle } from "../shared/util";
import { EventEmitter, getDbCheck, getProperties, Mutable, propertiesChanged,
	transaction } from "./db";
import { BaseNotification, Judgement, Notification, Problem, Submission,
	Team } from "./domjudge_types";

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
	return a.solves != b.solves ? b.solves-a.solves : a.totalPenaltyMinutes-b.totalPenaltyMinutes;
}

function rescore(scoreboard: Scoreboard): Scoreboard {
	const newTeams = [...scoreboard.teams.entries()].map(([k, v]) => {
		const newProblems = [...v.problems.entries()].map(([k2, v2]) => {
			const penaltyMs = v2.ac != true
				? 0
				: (scoreboard.startTimeMs == undefined
					? 0
					: (v2.submissionTimeMs-scoreboard.startTimeMs))+(scoreboard.penaltyTimeMs == undefined
						? 0
						: scoreboard.penaltyTimeMs*v2.incorrect);
			return [k2, { ...v2, penaltyMinutes: Math.floor(penaltyMs/(1000*60)) }] as const;
		});

		const penaltyMinutes = newProblems.reduce((a, b) => a+b[1].penaltyMinutes, 0);
		const solves = newProblems.reduce((a, b) => a+(b[1].ac == true ? 1 : 0), 0);
		return [k, { ...v, problems: new Map(newProblems), penaltyMinutes, solves }] as const;
	}).sort((a, b) => cmpTeam(a[1], b[1]));

	const rankedTeams = newTeams.map(([k, v], i) => {
		return [k, {
			...v,
			rank: i == 0 ? 1 : newTeams[i-1][1].rank+(cmpTeam(newTeams[i-1][1], v) < 0 ? 1 : 0),
		}] as const;
	});

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
	lastUpdate: string | null;
	isActive: boolean;
	doUpdateTeams: boolean;
};

const makeDomJudgeData = (): DOMJudgeData => ({
	problemInfo: new Map<string, Problem>(),
	judgements: new Map<string, Judgement>(),
	submission: new Map<string, Submission>(),
	teams: new Map<string, Team>(),
	isActive: false,
	lastUpdate: null,
	doUpdateTeams: false,
});

const defaultScoreboard: Scoreboard = { teams: new Map(), problemNames: new Map() };

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
		return this.#data.teams.get(domJudgeId)?.name ?? null;
	}

	// premature as hell
	// but also kind of sanity preserving, bc otherwise this seems a little weird
	// it just feels wrong to do all this shit every time someone e.g. changes
	// their team name with zero protection
	async #reallyUpdateTeams() {
		this.#data.doUpdateTeams = false;
		const newScoreboard = await transaction(async trx => {
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

				const scoreboardTeam = this.scoreboard.v.teams.get(data.id);
				return [data.id, {
					...scoreboardTeam ?? { rank: 0, solves: 0, totalPenaltyMinutes: 0, problems: new Map() },
					members: (await Promise.all(members.map(async mem => {
						return (await getDbCheck(trx, "user", mem.id)).data.submitted?.name;
					}))).filter(x => x != null),
					name: data.name,
					logo: logoId != null ? getTeamLogoURL(logoId.id) : null,
				}] as const;
			});

			return rescore({
				...this.scoreboard.v,
				teams: new Map((await Promise.all(proms)).filter(x => x != null)),
			});
		});

		this.scoreboard.v = newScoreboard;
	}

	updateTeams() {
		this.#throttle.call(() => {
			this.#data.doUpdateTeams = true;
		});
	}

	#domJudgeCid: string | null = null;
	async #poll() {
		const props = await transaction(trx => getProperties(trx));
		if ((props.domJudgeCid ?? null) != this.#domJudgeCid) {
			this.#domJudgeCid = props.domJudgeCid ?? null;
			this.#data = makeDomJudgeData();
			this.scoreboard.v = defaultScoreboard;
			this.activeContest.v = null;
		}

		if (this.#domJudgeCid == null) return;

		const authHeader = `Basic ${
			Buffer.from(`${process.env["DOMJUDGE_API_USER"]}:${process.env["DOMJUDGE_API_KEY"]}`)
				.toString("base64")
		}`;
		const u = new URL(
			`v4/contests/${props.domJudgeCid}/event-feed?stream=false`,
			process.env["DOMJUDGE_API_URL"],
		);

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
				this.scoreboard.v = {
					...this.scoreboard.v,
					problemNames: new Map([...this.#data.problemInfo.values()].map(v => [v.label, v.name])),
				};
			} else if (notif.type == "state") {
				const active = notif.data.ended == null && notif.data.started != null;
				this.activeContest.v = active
					? { cid: this.#domJudgeCid, name: this.scoreboard.v.contestName }
					: null;
			} else if (notif.type == "teams") {
				updateMapFromNotification(this.#data.teams, notif);
				this.updateTeams();
			} else if (notif.type == "submissions") {
				updateMapFromNotification(this.#data.submission, notif);
			} else if (notif.type == "judgements") {
				updateMapFromNotification(this.#data.judgements, notif);

				const newTeams = new Map(
					this.scoreboard.v.teams.entries().map((
						[k, v],
					): [
						number,
						Omit<ScoreboardTeam, "problems"> & { problems: Map<string, ScoreboardLastSubmission> },
					] => [k, { ...v, problems: new Map() }]),
				);

				await transaction(async trx => {
					for (const judgement of this.#data.judgements.values().filter(x => x.current != false)) {
						const sub = this.#data.submission.get(judgement.submission_id);
						if (!sub) throw new Error("judgement before submission");
						const prob = this.#data.problemInfo.get(sub.problem_id);
						if (!prob) throw new Error("judgement before problem");

						const data = await trx.selectFrom("team").select(["id"]).where(
							"domJudgeId",
							"=",
							sub.team_id,
						).executeTakeFirst();
						if (data == undefined) continue;

						const team = newTeams.get(data.id);
						if (!team) continue;

						const old = team.problems.get(prob.label);
						if (old?.ac == true) continue;

						const ac = judgement.end_time == null ? null : judgement.judgement_type_id == "AC";
						team.problems.set(prob.label, {
							ac,
							incorrect: (old?.incorrect ?? -1)+1,
							submissionTimeMs: relTimeToMs(judgement.start_contest_time),
							penaltyMinutes: 0,
						});
					}
				});

				this.scoreboard.v = rescore({ ...this.scoreboard.v, teams: newTeams });
			}

			if (notif.token != undefined) this.#data.lastUpdate = notif.token;
		}

		if (this.#data.doUpdateTeams) await this.#reallyUpdateTeams();
	}

	start() {
		let stop = false;
		this.defer(() => {
			stop = true;
		});
		void (async () => {
			while (!stop) {
				try {
					await this.#poll();
					await delay(200);
				} catch (e) {
					console.error("domjudge listener error", e);
					await delay(1000);
				}
			}
		})();
	}
}
