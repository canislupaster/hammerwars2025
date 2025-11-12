import { useEffect, useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { maxFactLength, teamFilesMaxSize, validFilenameRe } from "../../shared/util";
import { formatFileSize, LocalStorage, toBase64, useRequest } from "./clientutil";
import { MainContainer, useEmailVerification, useLoggedIn } from "./main";
import { ConfirmUnsubmit, useConfirmUnsubmit } from "./registration";
import { Alert, Anchor, bgColor, Button, Card, Checkbox, Divider, FileInput, Loading,
	LoadingOverlay, Text, Textarea, useGoto, useTimeUntil } from "./ui";

function ConfirmAttendanceInner() {
	const window = useRequest({ route: "registrationWindow", initRequest: true });
	const [pairUp, setPairUp] = useState(false);
	const [funFact, setFunFact] = useState("");
	const info = useRequest({
		route: "getInfo",
		initRequest: true,
		handler(res) {
			setPairUp(res.data.pairUp);
			setFunFact(res.data.team?.funFact ?? "");
		},
	});
	const c = { handler: () => info.call() };
	const updateTeamReq = useRequest({ route: "setTeam", ...c });
	const confirmReq = useRequest({ route: "confirmAttendance", ...c });
	const unsubmitReq = useRequest({ route: "updateInfo", ...c });

	const d = info.current;
	const team = d?.data.team ?? null;

	const untilClose = useTimeUntil(window.current?.data.inPersonCloses ?? null);
	const confirmAndUnsubmit = () => {
		if (d?.data.info == null) return;
		confirmReq.call({ pairUp });
		unsubmitReq.call({ info: d.data.info, submit: false });
	};
	const unsubmit = useConfirmUnsubmit(confirmAndUnsubmit);

	const [attempted, setAttempted] = useState(false);
	const loading = unsubmitReq.loading || confirmReq.loading || info.loading;
	useEffect(() => setAttempted(attempted || !loading), [attempted, loading]);
	if (window.current == null || d == null || (loading && !attempted)) return <Loading />;
	const closed = window.current.data.inPersonOpen == false || untilClose != null && untilClose < 0;

	const r = d?.data.submitted == false || d?.data.info.inPerson == null
		? "cancelled"
		: info.current.data.confirmedAttendance
		? "confirmed"
		: null;

	if (r == "cancelled") {
		return <>
			<Text v="md">You are no longer registered for HammerWars</Text>
			<Divider />
			<Text v="bold">i'm actualy going to cry :(</Text>
			<img src="/sad-sob.gif" className="mt-2" />
			{!closed && <Text className="mt-2">
				If that's a mistake, you can <Anchor href="/register">register again</Anchor>.
			</Text>}
		</>;
	} else if (team == null) {
		return <Alert bad title="Sorry, you haven't set a team by the registration deadline."
			txt="I accidentally sent the confirmation email to those without a team. Unfortunately, registration for teams has closed and we are well over capacity. Sorry..." />;
	}

	const soloing = team.members.length == 1;

	return <form onSubmit={ev => {
		const confirm = ev.submitter?.getAttribute("name") != "cancel";
		ev.preventDefault();
		// non-attendance is also "confirmed"
		if (confirm) {
			if (!ev.currentTarget.reportValidity()) return;
			confirmReq.call({ pairUp });
			if (team != null) {
				updateTeamReq.call({ name: team.name, funFact: funFact.length == 0 ? null : funFact });
			}
		} else if (closed) {
			unsubmit.open();
		} else {
			confirmAndUnsubmit();
		}
	}} className="flex flex-col gap-2">
		<LoadingOverlay open={loading} />
		<ConfirmUnsubmit {...unsubmit} />
		<Text v="big">Confirm your attendance</Text>

		<Divider />
		<Text v="md">Fun fact about your team</Text>
		<Text className="-mt-2" v="dim">
			Optional{funFact.length > 0 && `, ${funFact.length}/${maxFactLength}`}
		</Text>
		<Textarea value={funFact} onInput={ev => setFunFact(ev.currentTarget.value)} minLength={0}
			maxLength={maxFactLength} />
		<Divider />
		<Text v="md">Prewritten code</Text>
		<Text className="-mt-2" v="dim">
			You don't need prewritten code to solve most problems, and you'll have time during the
			practice contest to download whatever you want with full internet access. But if you like, you
			can upload arbitrary files now and avoid the pain of transferring them.
		</Text>
		<Card className="p-2">
			{team.files.length > 0
				? <div className="flex flex-col gap-1 text-sm">
					{team.files.map(file =>
						<Text className={twJoin(bgColor.secondary, "p-1 rounded-md")} key={file.name}>
							{file.name} ({formatFileSize(file.size)})
						</Text>
					)}
				</div>
				: <Text>No files uploaded yet.</Text>}
		</Card>
		<div className="flex flex-row flex-wrap gap-2">
			<FileInput type="button" loading={updateTeamReq.loading} multiple onUpload={files => {
				const allFiles = [...files, ...team.files];
				if (new Set(allFiles.map(v => v.name)).size != allFiles.length) {
					return "You can't upload two files with the same name.";
				}
				const totalSize = allFiles.map(v => v.size).reduce((a, b) => a+b, 0);
				if (totalSize > teamFilesMaxSize) {
					return `That's too big! ${formatFileSize(totalSize)} exceeds the maximum of ${
						formatFileSize(teamFilesMaxSize)
					}`;
				}
				const filenameRe = new RegExp(validFilenameRe);
				if (files.some(v => !filenameRe.test(v.name))) {
					return "Invalid filename";
				}
				void Promise.all(files.map(async f => ({ base64: await toBase64(f), name: f.name }))).then(
					files2 => updateTeamReq.call({ name: team.name, funFact: team.funFact, files: files2 })
				);
			}}>
				Upload files
			</FileInput>
			<Button type="button" disabled={team.files.length == 0} loading={updateTeamReq.loading}
				onClick={() =>
					updateTeamReq.call({ name: team.name, funFact: team.funFact, files: "remove" })}>
				Remove all files
			</Button>
		</div>
		<Divider />
		{soloing
			&& <Alert title={<Text v="md" className="mt-1">It looks like you're alone in your team</Text>}
				txt={
					<div className="flex flex-row gap-2 py-2 items-start -ml-8">
						<Checkbox className="mt-2" checked={pairUp} valueChange={setPairUp} />
						<div className="flex flex-col gap-1">
							<Text v="bold">Check this if you'd like a team chosen for you.</Text>
							<Text>We'll choose the best team name / logo.</Text>
						</div>
					</div>
				} />}
		<div className="flex flex-row gap-2">
			<Button className={bgColor.md} name="confirm">
				{r == "confirmed" ? "Update" : "Confirm"}
			</Button>
			<Button className={bgColor.red} name="cancel">Cancel</Button>
		</div>
		{r == "confirmed"
			&& <Alert className={bgColor.green} title="Thanks for confirming!"
				txt="We can't wait to see you there!" />}
	</form>;
}

export default function ConfirmAttendance() {
	const loggedIn = useLoggedIn();
	const verified = useEmailVerification();
	const createAccReq = useRequest({ route: "createAccount" });
	const redirectLogin = !loggedIn.loading && !loggedIn.loggedIn && verified.invalid;
	const goto = useGoto();
	useEffect(() => {
		if (
			verified.req != null && !verified.invalid && !createAccReq.loading
			&& createAccReq.current == null
		) {
			createAccReq.call({ ...verified.req, password: null });
		}
		if (redirectLogin) {
			LocalStorage.loginRedirect = "confirm";
			goto("/login");
		}
	}, [createAccReq, goto, redirectLogin, verified.invalid, verified.req]);

	if (redirectLogin || verified.loading || createAccReq.loading || loggedIn.loading) {
		return <Loading />;
	}

	return <MainContainer>
		<ConfirmAttendanceInner />
	</MainContainer>;
}
