import { useEffect, useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { maxFactLength, teamFilesMaxSize, validFilenameRe } from "../../shared/util";
import { formatFileSize, toBase64, useRequest } from "./clientutil";
import { ErrorPage, MainContainer, useEmailVerification } from "./main";
import { Alert, Anchor, bgColor, Button, Card, Divider, FileInput, Loading, Text,
	Textarea } from "./ui";

function ConfirmAttendanceInner() {
	const info = useRequest({ route: "getInfo", initRequest: true });
	const c = { handler: () => info.call() };
	const updateTeamReq = useRequest({ route: "setTeam", ...c });
	const confirmReq = useRequest({ route: "confirmAttendance", ...c });
	const unsubmitReq = useRequest({ route: "updateInfo", ...c });
	const [funFact, setFunFact] = useState("");

	const d = info.current;
	const team = d?.data.team ?? null;
	useEffect(() => {
		setFunFact(team?.funFact ?? "");
	}, [team?.funFact]);

	if (unsubmitReq.loading || confirmReq.loading || info.loading || d == null) return <Loading />;
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
			<Text className="mt-2">
				If that's a mistake, you can <Anchor href="/register">register again</Anchor>.
			</Text>
		</>;
	}

	return <form onSubmit={ev => {
		const confirm = ev.submitter?.getAttribute("name") != "cancel";
		ev.preventDefault();
		if (!ev.currentTarget.reportValidity()) return;
		// non-attendance is also "confirmed"
		confirmReq.call();
		if (confirm) {
			if (team != null) {
				updateTeamReq.call({ name: team.name, funFact: funFact.length == 0 ? null : funFact });
			}
		} else {
			unsubmitReq.call({ info: d.data.info, submit: false });
		}
	}} className="flex flex-col gap-2">
		<Text v="big">Confirm your attendance</Text>
		{team != null && <>
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
				practice contest to download whatever you want with full internet access. But if you like,
				you can upload arbitrary files now and avoid the pain of transferring them.
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
					void Promise.all(files.map(async f => ({ base64: await toBase64(f), name: f.name })))
						.then(files2 =>
							updateTeamReq.call({ name: team.name, funFact: team.funFact, files: files2 })
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
		</>}
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
	const verified = useEmailVerification();
	const createAccReq = useRequest({ route: "createAccount" });
	useEffect(() => {
		if (
			verified.req != null && !verified.invalid && !createAccReq.loading
			&& createAccReq.current == null
		) {
			createAccReq.call({ ...verified.req, password: null });
		}
	}, [createAccReq, verified]);

	if (verified.req == null || createAccReq.loading) return <Loading />;
	if (verified.invalid) return <ErrorPage errName="Invalid link." />;

	return <MainContainer>
		<ConfirmAttendanceInner />
	</MainContainer>;
}
