import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { APIClient, Scoreboard, ScoreboardTeam } from "../../shared/util";
import { apiBaseUrl, apiClient } from "./clientutil";
import { Pattern2, PatternBg } from "./home";
import { Text, useAsync } from "./ui";

function TeamRow({ id, team, i }: { id: number; team: ScoreboardTeam; i: number }) {
	return <div>{team.name}</div>;
}

export function ScoreboardPage() {
	const [teamRows, setTeamRows] = useState<ReadonlyMap<number, ScoreboardTeam>>(() => new Map());
	const async = useAsync(
		useCallback(async () => {
			for await (const update of apiClient.feed("scoreboard")) {
				setTeamRows(old => {
					const nrows = new Map(old);
					for (const [id, team] of update.teams) {
						if (team == null) nrows.delete(id);
						else nrows.set(id, team);
					}
					return nrows;
				});
			}
		}, []),
		{ propagateError: true },
	);
	useEffect(() => {
		async.run();
	}, [async]);

	const sorted = useMemo(() => [...teamRows.entries()].toSorted(([, a], [, b]) => a.rank-b.rank), [
		teamRows,
	]);

	return <div className="w-[80%] flex flex-col items-center">
		<div className="bg-black/40 w-full py-5 place-content-center flex">
			<h1 className="text-5xl flex flex-row">
				<span>HAMMERWARS</span>
				<span className="font-black">2025</span>
				<span className="inline-block w-[100px] shrink-0" />
				<span className="ml-auto">SCOREBOARD</span>
			</h1>
		</div>

		{sorted.map(([id, team], i) => <TeamRow key={id} id={id} i={i} team={team} />)}

		<PatternBg velocity={0} pat={() => new Pattern2()} />
	</div>;
}
