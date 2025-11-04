import { ContestProperties, PresentationState, SubmissionRankings } from "../shared/util";
import { getProperty, Mutable, propertiesChanged, transaction } from "./db";
import { domJudge } from "./domjudge";
import { openai } from "./main";

async function getPresentationState(
	prop: ContestProperties["presentation"],
): Promise<PresentationState> {
	const cur = prop.queue[prop.current];
	if (cur == null) {
		return { type: "none" };
	} else if (
		cur.type == "countdown" || cur.type == "submissions" || cur.type == "image"
		|| cur.type == "video" || cur.type == "scoreboard"
	) {
		return cur;
	} else if (cur.type == "duel") {
		throw new Error("unsupported");
	}
	return cur satisfies never;
}

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

class Presentation {
	state = new Mutable<PresentationState>({ type: "none" });
	async #loop() {
		let last = await transaction(async trx =>
			await getProperty(trx, "presentation") ?? { queue: [], current: 0 }
		);
		let changed = true;
		propertiesChanged.on(c => {
			if (c.k == "presentation") {
				last = c.v;
				changed = true;
			}
		});
		while (true) {
			try {
				while (changed) {
					changed = false;
					this.state.v = await getPresentationState(last);
				}
				await propertiesChanged.waitFor(x => x.k == "presentation");
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
