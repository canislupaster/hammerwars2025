import { IconSearch } from "@tabler/icons-preact";
import { Fragment } from "preact";
import { useLocation } from "preact-iso";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { Scoreboard } from "../../shared/util";
import { simp, useFeed, useRequest } from "./clientutil";
import { CodeBlock } from "./code";
import { ErrorPage, MainContainer } from "./main";
import { Alert, bgColor, borderColor, Button, Card, Divider, Input, Loading, Text, useLg,
	useTimeUntil } from "./ui";

function SubmissionBrowser(
	{ team, problem, scoreboard, setTeam, setProblem }: {
		team: number | null;
		problem: string | null;
		scoreboard: Scoreboard;
		setTeam: (team: number) => void;
		setProblem: (problem: string) => void;
	},
) {
	const [search, setSearch] = useState("");

	const validTeams = useMemo(() => {
		if (problem == null) return [];
		const k = search.length == 0 ? null : simp(search);
		return [...scoreboard.teams.entries()].filter(([, v]) => {
			return v.problems.has(problem)
				&& (k == null || simp(v.name).includes(k) || v.members.some(mem => simp(mem).includes(k)));
		});
	}, [problem, scoreboard.teams, search]);

	const lg = useLg();

	return <div className={twJoin("flex flex-col gap-2 max-w-full", lg && "-mt-10")}>
		<div className="flex flex-col gap-2">
			<Text v="md">Problems</Text>
			<div className="flex flex-row flex-wrap gap-2">
				{[...scoreboard.problemNames.keys()].map(label =>
					<Button key={label} onClick={() => setProblem(label)} data-selected={problem == label}>
						{label}
					</Button>
				)}
			</div>
		</div>
		<Divider />
		{problem == null
			? <Card>Select a problem to browse solutions.</Card>
			: <div
				className={twJoin(
					"flex items-stretch max-w-full",
					lg ? "flex-row gap-2 max-h-[70vh]" : "flex-col gap-2",
				)}>
				<div className={twJoin("flex flex-col gap-3 items-stretch", lg && "max-w-xs")}>
					<Text v="md">Teams</Text>
					<Input icon={<IconSearch />} value={search}
						onInput={ev => setSearch(ev.currentTarget.value)} placeholder="Search teams…" />
					{validTeams.length == 0
						? <Alert title="No matching teams"
							txt="Try clearing the search or picking another problem." />
						: <div className="flex flex-col items-stretch overflow-auto ">
							{validTeams.map(([id, data]) =>
								<Button key={id} onClick={() => setTeam(id)}
									className={twJoin(
										"border-y-[1px] overflow-x-auto shrink-0",
										team == id && bgColor.secondary,
										team == id && borderColor.blue,
									)}>
									{data.name}
								</Button>
							)}
						</div>}
				</div>
				{lg ? <Divider vert className="h-auto self-stretch" /> : <Divider />}
				<SubmissionDetails scoreboard={scoreboard} team={team} problem={problem} />
			</div>}
	</div>;
}

function SubmissionDetails(
	{ scoreboard, team, problem }: {
		scoreboard: Scoreboard;
		team: number | null;
		problem: string | null;
	},
) {
	const initRequest = useMemo(
		() => team != null && problem != null ? { team, problem } : undefined,
		[problem, team],
	);

	const { current, loading } = useRequest<"getSubmission", false>({
		route: "getSubmission",
		throw: false,
		initRequest,
	});

	const lg = useLg();

	if (team == null || problem == null) {
		return <Card className="self-start grow">Pick a team to view details & code.</Card>;
	}

	const teamData = scoreboard.teams.get(team);
	const problemName = scoreboard.problemNames.get(problem);
	const solveInfo = teamData?.problems.get(problem);
	if (teamData == null || solveInfo == null) throw new Error("solve not found");
	const submission = current?.type == "ok" ? current.data : null;
	const submissionError = current?.type == "error" ? current.error : null;

	const status = solveInfo.ac == true
		? "Accepted"
		: solveInfo.ac == false
		? solveInfo.verdict ?? "Rejected"
		: "Pending";

	const contestMinute = solveInfo != null && scoreboard.startTimeMs != null
		? Math.floor((solveInfo.submissionTimeMs-scoreboard.startTimeMs)/(60_000))
		: null;

	return <Card className={twJoin("flex grow-0 flex-col gap-3 pb-2", lg && "max-w-3xl")}>
		<div className="flex flex-col gap-1">
			<Text v="md">{problem}. {problemName ?? "Unknown problem"}</Text>
			<Text v="smbold">Team {teamData.name}</Text>
			{teamData.members.length > 0
				&& <Text v="sm" className="text-left">{teamData.members.join(", ")}</Text>}
		</div>
		<Divider className="my-0" />
		<div
			className={twJoin(
				"grid",
				lg ? "grid-cols-[auto_1fr_auto_auto_1fr]" : "grid-cols-[auto_1fr]",
			)}>
			{([
				["Status", status],
				...(solveInfo == null
					? []
					: [
						["Incorrect", `${solveInfo.incorrect ?? 0}`],
						["Penalty", `${solveInfo.penaltyMinutes ?? 0} minutes`],
						...(contestMinute != null ? [["Contest Time", `${contestMinute} minutes`]] : []),
						...(solveInfo.first ? [["First Solve", "Yes"]] : []),
					]),
				...(submission == null
					? []
					: [["Filename", submission.filename], ["Language", submission.language], [
						"Runtime",
						submission.runtime != null ? `${submission.runtime.toFixed(3)} s` : "—",
					]]),
			] as const).map(([label, value], i) => (<Fragment key={label}>
				<Text v="smbold"
					className={twJoin("text-right border-r-2 py-0.5 pr-2", borderColor.divider)}>
					{label}
				</Text>
				<Text v="sm" className="pl-2">{value}</Text>
				{lg && i%2 == 0 && <span className="w-5" />}
			</Fragment>))}
		</div>
		{submissionError != null
			&& <Alert title="Unable to load submission" bad
				txt={submissionError.msg ?? "Please try again later."} />}
		{loading && submission == null && <Loading />}
		{submission != null && <>
			<CodeBlock className={twJoin("overflow-auto border-2 -mx-2", borderColor.default)}
				source={submission.source} language={submission.language} />
		</>}
	</Card>;
}

export default function SubmissionsPage(
	{ team: initTeam, problem: initProblem }: { team?: string; problem?: string },
) {
	const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
	useFeed("scoreboard", setScoreboard);
	const untilEnd = useTimeUntil(scoreboard?.endTimeMs ?? null);

	const [teamProblem, setTeamProblem] = useState<{ team: number | null; problem: string | null }>({
		team: null,
		problem: null,
	});

	const loc = useLocation();
	const updateTeamProblem = useCallback((v: typeof teamProblem) => {
		if (scoreboard == null || v.problem == null || !scoreboard.problemNames.has(v.problem)) {
			v = { team: null, problem: null };
		} else {
			const scTeam = scoreboard.teams.get(v.team ?? -1);
			if (v.team == null || scTeam == null || !scTeam.problems.has(v.problem)) {
				v = { team: null, problem: v.problem };
			}
		}

		let path = "/submissions";
		if (v.problem != null) {
			path += `/${v.problem}`;
			if (v.team != null) path += `/${v.team}`;
		}

		if (loc.path != path) {
			loc.route(path);
		}

		setTeamProblem(v);
	}, [loc, scoreboard]);

	useEffect(() => {
		let teamId: number | null = null;
		if (initTeam != null && initTeam.length > 0) {
			const ret = parseInt(initTeam, 10);
			if (!isFinite(ret)) throw new Error("Invalid team parameter");
			teamId = ret;
		}
		setTeamProblem({ team: teamId, problem: initProblem ?? null });
	}, [initTeam, initProblem]);

	const setTeam = useCallback(
		(t: number | null) => updateTeamProblem({ ...teamProblem, team: t }),
		[teamProblem, updateTeamProblem],
	);
	const setProblem = useCallback(
		(p: string | null) => updateTeamProblem({ ...teamProblem, problem: p }),
		[teamProblem, updateTeamProblem],
	);

	if (scoreboard == null) return <Loading />;
	if (untilEnd == null || untilEnd >= 0) {
		return <ErrorPage errName="Submissions aren't accessible yet">
			I'm not sure how you got here, but please wait until the contest is over!
		</ErrorPage>;
	}

	return <MainContainer className="max-w-6xl">
		<SubmissionBrowser problem={teamProblem.problem} team={teamProblem.team} setTeam={setTeam}
			setProblem={setProblem} scoreboard={scoreboard} />
	</MainContainer>;
}
