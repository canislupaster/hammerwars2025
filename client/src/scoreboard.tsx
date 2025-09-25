import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { APIClient, cmpTeam, Scoreboard, ScoreboardTeam } from "../../shared/util";
import { apiBaseUrl, apiClient } from "./clientutil";
import { mapWith, Text, useAsync } from "./ui";

function TeamRow({ id, team, i }: { id: number; team: ScoreboardTeam; i: number }) {
	return <div>{i}</div>;
}

export function ScoreboardPage() {
	const [teamRows, setTeamRows] = useState<ReadonlyMap<number, ScoreboardTeam>>(() => new Map());
	const async = useAsync(
		useCallback(async () => {
			for await (const update of await apiClient.feed("scoreboard")) {
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

	const sorted = useMemo(() => [...teamRows.entries()].toSorted(([, a], [, b]) => cmpTeam(a, b)), [
		teamRows,
	]);

	return <div>
		<Text v="big">Hammerwars 2025 scoreboard</Text>
		{sorted.map(([id, team], i) => <TeamRow key={id} id={id} i={i} team={team} />)}
	</div>;
}
