import { createHash, randomBytes } from "node:crypto";
import { env } from "node:process";
import { ContestProperties, delay, DuelState, fill, PresentationSlide, PresentationState,
	SubmissionRankings } from "../shared/util";
import { EventEmitter, getProperty, Mutable, propertiesChanged, transaction } from "./db";
import { DOMJudge, domJudge } from "./domjudge";
import { openai } from "./main";
import { fetchDispatcher } from "./proxies";

export async function evalSolutionQuality(
	source: string,
	intendedSolution: string | null,
): Promise<number> {
	if (source.length > -1) return 0;

	const resp = await openai.responses.create({
		model: "gpt-5",
		input: [{
			role: "developer",
			content: [{
				type: "input_text",
				text:
					"Evaluate this solution's simplicity and code quality from a competitive programming standpoint. Concision and clarity are key. For instance, a well-commented solution which divides into cases is *worse* than a poorly formatted, uncommented solution which simplifies into a single case."+(intendedSolution
							== null
						? ""
						: "\n\nFor reference, one intended solution for this problem is:\n```"+intendedSolution+"```"),
			}],
		}, { role: "user", content: [{ type: "input_text", text: "```"+source+"```" }] }],
		text: {
			format: {
				type: "json_schema",
				name: "competitive_programming_solution_score",
				strict: true,
				schema: {
					type: "object",
					properties: {
						score: {
							type: "number",
							description:
								"A single numeric score representing the quality of the solution between 0 and 1.",
							minimum: 0,
							maximum: 1,
						},
					},
					required: ["score"],
					additionalProperties: false,
				},
			},
			verbosity: "low",
		},
		reasoning: { effort: "low", summary: null },
		tools: [],
		store: true,
	});

	if (resp.status != "completed") {
		return 0;
	}

	try {
		const score = (JSON.parse(resp.output_text) as { score?: unknown }).score;
		if (typeof score != "number" || !isFinite(score) || score < 0 || score > 1) return 0;
		return score;
	} catch {
		// refusal, token limit reached, etc
		return 0;
	}
}

export async function evalSolutions(
	subs: Awaited<ReturnType<typeof domJudge.getPreFreezeSolutions>>[0],
	intendedSolutions: { label: string; intendedSolution: string }[],
) {
	const categories = ["fastest", "cleanest", "slowest", "longest", "shortest", "first"] as const;
	const toIntendedSolution = new Map(intendedSolutions.map(v => [v.label, v.intendedSolution]));

	return await Promise.all(categories.map(async cat => {
		const scored = await Promise.all(subs.map(async sub => {
			let score: number | null;
			let value: string | null = null;
			if (cat == "fastest" || cat == "slowest") {
				score = sub.runtime != null ? (cat == "fastest" ? -1 : 1)*sub.runtime : null;
				value = sub.runtime != null ? `${sub.runtime.toFixed(2)} s` : null;
			} else if (cat == "cleanest") {
				const intended = toIntendedSolution.get(sub.problem) ?? null;
				score = await evalSolutionQuality(sub.source, intended);
			} else if (cat == "first") {
				score = -sub.contestTime;
				value = `${Math.floor(sub.contestTime/1000/60)} minutes`;
			} else if (cat == "shortest" || cat == "longest") {
				score = (cat == "shortest" ? -1 : 1)*sub.source.length;
				value = `${(sub.source.length/1e3).toFixed(2)}k characters`;
			} else {
				return cat satisfies never;
			}
			return score == null ? null : { ...sub, score, value };
		}));

		return {
			category: cat,
			candidates: scored.filter(x => x != null).sort((a, b) => b.score-a.score).map(v => ({
				...v,
				title: `${cat[0].toUpperCase()}${cat.slice(1)} solution${
					v.value != null ? ` (${v.value})` : ""
				}`,
				language: v.languageName,
				summary: `Submitted under ${v.name} at ${Math.floor(v.contestTime/1000/60/60)}:${
					(Math.floor(v.contestTime/1000/60)%60).toString().padStart(2, "0")
				}${v.runtime != null && ` taking ${v.runtime.toFixed(2)} of ${v.tl} seconds`}.`,
			})),
		} satisfies SubmissionRankings["problems"][number]["solutions"][number];
	}));
}

type CodeforcesResponse<T> = { status: "OK" | "FAILED"; result?: T; comment?: string };
type CodeforcesStandingsResult = {
	contest?: {
		id: number;
		name: string;
		startTimeSeconds?: number;
		durationSeconds?: number;
		phase?: string;
	};
	problems: { index: string; name: string; rating?: number }[];
	rows: {
		penalty?: number;
		party?: { members?: { handle: string }[] };
		problemResults?: {
			points: number;
			bestSubmissionTimeSeconds?: number;
			rejectedAttemptCount?: number;
		}[];
	}[];
};

type Event = "slide" | "liveSlide" | "liveOverlay" | "presentationProp" | "liveProp";

class Presentation {
	slide: PresentationSlide = { type: "none" };
	liveState: { slide: PresentationSlide; overlaySrc: string | null } = {
		slide: { type: "none" },
		overlaySrc: null,
	};

	events = new EventEmitter<Event>();

	async #codeforces<T>(
		path: string,
		params: Record<string, string>,
		signal?: AbortSignal,
	): Promise<T> {
		const url = new URL(path, "https://codeforces.com/api/");
		for (const k in params) url.searchParams.set(k, params[k]);

		// wtf mike, Bearer token isn't good enough?
		if (env.CF_API_KEY != null && env.CF_API_SECRET != null) {
			url.searchParams.set("time", Math.floor(Date.now()/1000).toString());
			url.searchParams.set("apiKey", env.CF_API_KEY);
			const paramStr = [...url.searchParams.entries()].sort((a, b) =>
				a[0] == b[0] && a[1] == b[1] ? 0 : a[0] < b[0] || a[0] == b[0] && a[1] < b[1] ? -1 : 1
			).map(([k, v]) => `${k}=${v}`).join("&");

			const rand = randomBytes(3).toString("hex");
			const sig = createHash("SHA-512").update(
				`${rand}/${path}?${paramStr}#${env.CF_API_SECRET}`,
				"utf-8",
			).digest().toString("hex");
			url.searchParams.set("apiSig", `${rand}${sig}`);
		}

		return await fetchDispatcher<T>(
			{},
			async resp => {
				if (!resp.ok) {
					throw new Error(`Codeforces API error (${resp.status})`);
				}
				const data = await resp.json() as CodeforcesResponse<T>;
				if (data.status != "OK" || data.result == undefined) {
					throw new Error(data.comment ?? "Codeforces API returned an error");
				}
				return data.result;
			},
			url,
			{ signal, headers: { accept: "application/json" } },
		);
	}

	async #updateLive() {
		const live = await transaction(trx => getProperty(trx, "live")) ?? [];
		const activeLive = live.find(x => x.active);
		const overlayLive = live.find(x => x.overlay);
		const slide = activeLive != null
			? (this.liveState.slide.type == "live" && activeLive.src == this.liveState.slide.src
				? this.liveState.slide
				: { type: "live", src: activeLive.src } as const)
			: this.slide;
		const overlaySrc = overlayLive?.src ?? null;
		const old = this.liveState;
		this.liveState = { slide, overlaySrc };
		if (slide != old.slide) this.events.emit("liveSlide");
		if (overlaySrc != old.overlaySrc) this.events.emit("liveOverlay");
	}

	async #setSlide(slide: PresentationSlide) {
		this.slide = slide;
		this.events.emit("slide");
		await this.#updateLive();
	}

	async #controlPresentation(abort: AbortSignal) {
		const queue = await transaction(trx => getProperty(trx, "presentation"))
			?? { queue: [], current: 0 };
		const state = queue.queue[queue.current];

		if (state == null) {
			await this.#setSlide({ type: "none" });
		} else if (
			state.type == "countdown" || state.type == "image" || state.type == "video"
			|| state.type == "none" || state.type == "scoreboard" || state.type == "live"
		) {
			await this.#setSlide(state);
		} else if (state.type == "submissions") {
			const scoreboard = domJudge.scoreboard.v;
			const slides = state.problems.flatMap(prob =>
				prob.solutions.map(
					sol => ({ data: sol, problemLabel: prob.label, scoreboard, type: "submission" } as const)
				)
			);

			let i = 0;
			const slideDur = 20_000;
			while (!abort.aborted && slides.length > 0) {
				const slide = slides[(i++)%slides.length];
				await this.#setSlide({ ...slide, end: Date.now()+slideDur });
				await delay(slideDur, abort);
			}
		} else if (state.type == "duel") {
			let first = true;
			while (!abort.aborted) {
				const duelCfg = await transaction(trx => getProperty(trx, "duel"));
				if (duelCfg == null) {
					await this.#setSlide({ type: "none" });
				} else {
					const standings = await this.#codeforces<CodeforcesStandingsResult>("contest.standings", {
						contestId: `${duelCfg.cfContestId}`,
						handles: duelCfg.players.map(v => v.cf).join(";"),
					});

					const standingsByPlayer = new Map(
						standings.rows.flatMap(v =>
							(v.party?.members ?? []).map((
								{ handle },
							) => [
								handle,
								v.problemResults?.map((x, i) => ({ i, x })).filter(x =>
									x.x.bestSubmissionTimeSeconds != null && x.x.points > 0
								).map(({ x, i }) => ({
									problemI: i,
									time: x.bestSubmissionTimeSeconds!,
									first: false,
								})) ?? [],
							])
						),
					);

					for (
						const solves of Map.groupBy([...standingsByPlayer.values()].flat(), v => v.problemI)
							.values()
					) {
						solves.sort((u, v) => u.time-v.time);
						if (solves.length > 0) solves[0].first = true;
					}

					await this.#setSlide({
						type: "duel",
						layout: duelCfg.layout,
						problemLabels: standings.problems.map(v => v.index),
						players: duelCfg.players.map(v => ({
							...v,
							solved: new Set(
								(standingsByPlayer.get(v.cf)?.values() ?? []).filter(x => x.first).map(u =>
									standings.problems[u.problemI].index
								),
							),
						})),
						noTransition: !first,
					});

					first = false;
				}

				await delay(500, abort);
			}
		}
	}

	async #loop() {
		let lastControl: [Promise<void>, AbortController] | null = null;
		propertiesChanged.on(c => {
			if (c.k == "presentation") {
				this.events.emit("presentationProp");
			} else if (c.k == "live") {
				this.events.emit("liveProp");
			}
		});

		const evQueue: Event[] = [];
		this.events.on(x => evQueue.push(x));

		while (true) {
			try {
				while (true) {
					const ev = evQueue.shift();
					if (ev == null) break;
					if (ev == "liveProp" || ev == "liveOverlay") await this.#updateLive();
					else if (ev == "presentationProp") {
						if (lastControl != null) {
							lastControl[1].abort();
							await lastControl[0];
						}
						const abort2 = new AbortController();
						const prom = this.#controlPresentation(abort2.signal);
						lastControl = [prom, abort2];
					}
				}
				await this.events.wait();
			} catch (e) {
				console.error("presentation error", e);
			}
		}
	}
	start() {
		void this.#loop();
	}
}

export const presentation = new Presentation();
presentation.start();
