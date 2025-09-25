import { IconClipboard, IconDice } from "@tabler/icons-preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { randomShirtSeed } from "../../shared/genshirt";
import { API, joinCodeRe, logoMaxSize, logoMimeTypes, maxPromptLength, PartialUserInfo,
	resumeMaxSize, ServerResponse, shirtSizes, UserInfo, validDiscordRe,
	validNameRe } from "../../shared/util";
import { apiBaseUrl, apiClient, useRequest } from "./clientutil";
import type { GenShirtMessage, GenShirtResponse } from "./genshirtworker";
import GenShirtWorker from "./genShirtWorker?worker";
import { MainContainer } from "./main";
import { Alert, Anchor, AppTooltip, bgColor, borderColor, Button, Card, Checkbox, Collapse,
	Countdown, Divider, FileInput, IconButton, Input, Loading, Modal, Select, Text, Textarea,
	ThemeSpinner, useDebounce, useGoto, useToast, useValidity } from "./ui";

const toBase64 = (file: File) =>
	new Promise<string>((res, rej) => {
		const reader = new FileReader();
		reader.onload = () => {
			const d = reader.result as string;
			res(d.slice(d.indexOf(",")+1));
		};
		reader.onerror = rej;
		reader.readAsDataURL(file);
	});

function GenerateTeamLogo({ refresh }: { refresh: () => void }) {
	const [generateLogoOpen, setGenerateLogoOpen] = useState(false);
	const generateTeamLogo = useRequest({
		route: "generateLogo",
		throw: false,
		handler: r => {
			if (r.type == "ok") {
				setGenerateLogoOpen(false);
				refresh();
			}
		},
	});
	const [generateLogoPrompt, setGenerateLogoPrompt] = useState("");
	return <>
		<Modal open={generateLogoOpen} onClose={() => setGenerateLogoOpen(false)}
			title="Generate team logo">
			<form className="contents" onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					generateTeamLogo.reset();
					generateTeamLogo.call({ prompt: generateLogoPrompt });
				}
			}}>
				<Text v="bold">Enter a prompt</Text>
				<Textarea disabled={generateTeamLogo.loading} maxLength={maxPromptLength}
					value={generateLogoPrompt}
					onInput={ev => setGenerateLogoPrompt(ev.currentTarget.value)} />
				<Button loading={generateTeamLogo.loading}>Generate logo</Button>
				<Text>This may take up to a minute.</Text>
				{generateTeamLogo.current?.type == "error"
					&& <Alert bad title="Error generating logo" txt={generateTeamLogo.current.error.msg} />}
			</form>
		</Modal>

		<Button onClick={() => {
			setGenerateLogoOpen(true);
		}}>
			Generate logo
		</Button>
	</>;
}

export function ShirtPreview(
	{ info, setSeed, setHue }: {
		info: Pick<API["getInfo"]["response"] & { type: "ok" }, "info" | "team">;
		setSeed: (x: number) => void;
		setHue: (x: number) => void;
	},
) {
	const name = info.info.name,
		team = info.team?.name,
		teamLogo = info.team?.logo,
		seed = info.info.shirtSeed,
		hue = info.info.shirtHue;

	const [res, setRes] = useState<GenShirtResponse | null>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const db = useDebounce(200);
	useEffect(() => {
		if (!db) return;
		setRes(null);
		const worker = new GenShirtWorker();
		db.call(() => {
			worker.postMessage(
				{
					name: name ?? "",
					team: team ?? "",
					quality: "low",
					hue,
					logo: teamLogo != undefined ? new URL(teamLogo, apiBaseUrl).href : undefined,
					seed,
				} satisfies GenShirtMessage,
			);
		});

		worker.onmessage = msg => {
			const resp = msg.data as GenShirtResponse;
			setRes(resp);
			if (resp.type == "success") {
				const canvas = canvasRef.current;
				const ctx = canvas?.getContext("2d");
				if (ctx && canvas) {
					canvas.width = resp.data.width;
					canvas.height = resp.data.height;
					ctx.putImageData(resp.data, 0, 0);
				}
			}
		};

		return () => worker.terminate();
	}, [db, hue, name, seed, team, teamLogo]);

	return <div className="flex flex-col gap-1 w-full">
		<Text v="md">Shirt preview</Text>
		<Button type="button" onClick={() => {
			setSeed(randomShirtSeed());
		}} icon={<IconDice />}>
			Randomize seed
		</Button>

		<div className="flex flex-row gap-2 w-full mt-1">
			<Text>Hue</Text>
			<input value={hue} onInput={ev => setHue(ev.currentTarget.valueAsNumber)} type="range" min={0}
				max={360} className="grow" />
		</div>

		<Collapse className="self-center">
			<div hidden={res?.type == "error"} className="max-w-md m-3 bg-black p-3 flex flex-col">
				{res == null && <Loading>
					<Text>Generating shirt...</Text>
				</Loading>}
				<canvas hidden={res == null} ref={canvasRef} className="max-w-full h-auto" />
			</div>

			{res?.type == "error" && <Alert bad title="Error generating shirt" txt={res.msg} />}
		</Collapse>
	</div>;
}

export function RegistrationEditor() {
	const [data, setData] = useState<API["getInfo"]["response"] | null>(null);
	type InPerson = NonNullable<UserInfo["inPerson"]>;
	const [userInfo, setUserInfo] = useState<PartialUserInfo | null>(null);

	const info = useRequest({
		route: "getInfo",
		initRequest: true,
		handler(res) {
			if (res.type == "ok") {
				setData(res.data);
				if (data == null) {
					setUserInfo({
						...res.data.info,
						inPerson: res.data.info.inPerson ?? null,
						discord: res.data.info.discord ?? null,
					});
				}
			}
		},
	});

	const window = useRequest({ route: "registrationWindow", initRequest: true });

	const infoCall = info.call;
	const refresh = useCallback((x: ServerResponse<keyof API>) => {
		if (x.type == "ok") infoCall();
	}, [infoCall]);

	const [showMissing, setShowMissing] = useState(false);
	const updateInfo = useRequest({
		route: "updateInfo",
		handler: r => {
			refresh(r);
			setShowMissing(false);
		},
	});
	const updateResume = useRequest({ route: "updateResume", handler: refresh });

	const getResume = useRequest({
		route: "getResume",
		handler(res) {
			if (res.type == "ok" && res.data != null) {
				const linkSource = `data:application/pdf;base64,${res.data}`;
				const downloadLink = document.createElement("a");
				downloadLink.href = linkSource;
				downloadLink.download = "resume.pdf";
				downloadLink.click();
			}
		},
		throw: false,
	});

	const updateTeam = useRequest({ route: "setTeam", handler: refresh });

	const joinTeam = useRequest({ route: "joinTeam", handler: refresh });
	const leaveTeam = useRequest({ route: "leaveTeam", handler: refresh });
	const [newPass, setNewPass] = useState<string>("");
	const changePassword = useRequest({
		route: "setPassword",
		handler(res) {
			if (res.type == "ok") {
				setNewPass("");
			}
		},
	});

	const deleteUser = useRequest({
		route: "deleteUser",
		handler(res) {
			if (res.type == "ok") {
				goto("/login");
			}
		},
	});

	const goto = useGoto();

	const teamNameValidity = useValidity(data?.team?.name ?? "", v => {
		if (data?.team) setData({ ...data, team: { ...data.team, name: v } });
	});
	const formRef = useRef<HTMLFormElement>(null);

	const [createTeamOpen, setCreateTeamOpen] = useState(false);
	const [createTeamName, setCreateTeamName] = useState("");

	const [joinTeamOpen, setJoinTeamOpen] = useState(false);
	const [joinTeamCode, setJoinTeamCode] = useState("");

	const [deleteUserOpen, setDeleteUserOpen] = useState(false);

	const loading = info.loading || updateInfo.loading || updateTeam.loading || leaveTeam.loading
		|| joinTeam.loading || changePassword.loading || updateResume.loading;
	const team = data?.team ?? null;

	const [hasClosed, setHasClosed] = useState<boolean | null>(null);
	useEffect(() => {
		if (window.current?.data.closes != null) {
			const closes = window.current.data.closes;
			if (Date.now() >= closes) setHasClosed(true);
			else {
				setHasClosed(false);
				const tm = setTimeout(() => setHasClosed(true), closes-Date.now());
				return () => {
					clearTimeout(tm);
					setHasClosed(null);
				};
			}
		} else {
			setHasClosed(false);
		}
		return () => setHasClosed(null);
	}, [window]);

	const missing = useMemo(
		() => ({
			name: userInfo?.name == undefined,
			pizza: userInfo?.inPerson != null && userInfo.inPerson.pizza == undefined,
			sandwich: userInfo?.inPerson != null && userInfo.inPerson.sandwich == undefined,
			shirtSize: userInfo?.inPerson != null && userInfo.inPerson.shirtSize == undefined,
			resume: data?.hasResume != true,
		} as const),
		[userInfo, data],
	);
	const makeMissingAlert = (x: keyof typeof missing, name: string) =>
		showMissing && missing[x]
		&& <Alert bad title={`${name} is required`} txt="Please specify it before submitting." />;
	const anyMissing = Object.values(missing).some(x => x);

	const toast = useToast();

	if (data == null || userInfo == null || window.current == null || hasClosed == null) {
		return <Loading />;
	}

	const registrationClosed = !window.current.data.open || hasClosed;

	const modInfo = <K extends keyof PartialUserInfo>(key: K, newV: PartialUserInfo[K]) => {
		if (!loading) setUserInfo({ ...userInfo, [key]: newV });
	};

	const modInPerson = <K extends keyof NonNullable<PartialUserInfo["inPerson"]>>(
		key: K,
		newV: NonNullable<PartialUserInfo["inPerson"]>[K],
	) => {
		if (userInfo.inPerson) {
			modInfo("inPerson", { ...userInfo.inPerson, [key]: newV });
		}
	};

	return <MainContainer>
		<Card className="w-full max-w-2xl gap-3">
			<Text v="lg">User information</Text>
			{registrationClosed
				? <Alert title="Registration has closed" txt="You can't submit information anymore." />
				: <>
					{data.submitted
						&& <Alert title="Unsubmit to edit your information" txt="Don't forget to resubmit!" />}
					{window.current.data.closes != null && <>
						<Text v="bold">Registration closes in</Text>
						<div className="flex flex-row gap-2 justify-evenly max-w-xs self-center">
							<Countdown until={window.current.data.closes/1000} />
						</div>
					</>}
				</>}
			<form ref={formRef} onSubmit={ev => {
				ev.preventDefault();
				if (anyMissing) {
					setShowMissing(true);
				} else if (!data.submitted && !registrationClosed && ev.currentTarget.reportValidity()) {
					updateInfo.call({ info: userInfo, submit: true });
				}
			}}>
				<div className={"flex flex-col gap-3 max-w-xl items-stretch relative"}
					inert={loading || data.submitted}>
					<Text v="md" className="-mb-2">Your name</Text>
					<Input pattern={validNameRe} value={userInfo.name ?? ""}
						valueChange={v => modInfo("name", v == "" ? undefined : v)} />
					{makeMissingAlert("name", "Name")}

					<Text v="md" className="-mb-2">Discord</Text>
					<Input value={userInfo.discord ?? ""} pattern={validDiscordRe}
						valueChange={v => modInfo("discord", v.length > 0 ? v : null)} />

					<Divider />

					<Checkbox checked={userInfo.inPerson != null} valueChange={v => {
						modInfo("inPerson", v ? (userInfo.inPerson ?? { needTransportation: false }) : null);
					}} label="Will you be attending in person?" />

					{userInfo.inPerson != null
						&& (<div
							className={twJoin(
								"flex flex-col gap-3 pl-3 items-stretch border-l py-1",
								borderColor.divider,
							)}>
							<Checkbox checked={userInfo.inPerson.needTransportation} valueChange={v =>
								modInPerson("needTransportation", v)}
								label={"Do you require transportation (teams within driving distance only)?"} />
							{userInfo.inPerson.needTransportation
								&& <Text>We'll reach out to you to help arrange transportation.</Text>}

							<div className="flex flex-col gap-1">
								<Text v="bold">Resume</Text>
								<Text>Our sponsors are excited to learn about you!</Text>
								{data.hasResume
									&& <Anchor onClick={() => getResume.call()}>Download your resume</Anchor>}
								<div className="flex flex-row gap-2">
									<FileInput disabled={loading} maxSize={resumeMaxSize}
										mimeTypes={["application/pdf"]} onUpload={x => {
										void toBase64(x).then(base64 => {
											updateResume.call({ type: "add", base64 });
										});
									}} />
									{data.hasResume && <Button onClick={() => {
										updateResume.call({ type: "remove" });
									}} type="button">
										Remove resume
									</Button>}
								</div>
								{makeMissingAlert("resume", "Resume")}
							</div>

							<div className="flex flex-col gap-1">
								<Text v="bold">Papa Johns pizza</Text>
								<Select
									options={[
										{ label: "Unset", value: "unset" },
										{ label: "I don't want dinner", value: "none" },
										{ label: "Cheese", value: "cheese" },
										{ label: "Pepperoni", value: "pepperoni" },
										{ label: "Sausage", value: "sausage" },
									] as const}
									value={userInfo.inPerson?.pizza ?? "unset" as const}
									setValue={v => modInPerson("pizza", v == "unset" ? undefined : v)} />
								{makeMissingAlert("pizza", "Pizza choice")}
							</div>

							<div className="flex flex-col gap-1">
								<Text v="bold">Panera sandwich</Text>
								<Select
									options={[
										{ label: "Unset", value: "unset" },
										{ label: "I don't want lunch", value: "none" },
										{ label: "Chicken Bacon Rancher", value: "chickenBaconRancher" },
										{ label: "Chipotle Chicken Avo Melt", value: "chipotleChickenAvoMelt" },
										{ label: "Toasted Garden Caprese", value: "toastedGardenCaprese" },
										{ label: "Bacon Turkey Bravo", value: "baconTurkeyBravo" },
									] as const}
									value={userInfo.inPerson?.sandwich ?? "unset" as const}
									setValue={v => modInPerson("sandwich", v == "unset" ? undefined : v)} />
								{makeMissingAlert("sandwich", "Sandwich choice")}
							</div>

							<div className="flex flex-col gap-1">
								<Text v="bold">Shirt size</Text>
								<Select
									options={[{ label: "Unset", value: "unset" }, {
										label: "I don't want a shirt",
										value: "none",
									}, ...shirtSizes.map(v => ({ label: v.toUpperCase(), value: v }))] as {
										label: string;
										value: "unset" | InPerson["shirtSize"];
									}[]}
									value={userInfo.inPerson.shirtSize ?? "unset" as const}
									setValue={v => modInPerson("shirtSize", v == "unset" ? undefined : v)} />
								{makeMissingAlert("shirtSize", "Shirt size")}
							</div>

							<ShirtPreview info={{ info: userInfo, team }} setSeed={s => {
								modInfo("shirtSeed", s);
							}} setHue={h => {
								modInfo("shirtHue", h);
							}} />
						</div>)}
				</div>
				{data.submitted
					? <div className="flex flex-row gap-2 items-center mt-5">
						<Button loading={loading} onClick={() => {
							updateInfo.call({ info: userInfo, submit: false });
						}} className={bgColor.sky}>
							Unsubmit
						</Button>
					</div>
					: <div className="flex flex-row gap-2 items-center mt-5">
						<Button loading={loading} disabled={loading || registrationClosed}
							className={bgColor.green}>
							Submit
						</Button>
						<AppTooltip content="Use this option if you'd like to submit your information later.">
							<Button loading={loading} onClick={() => {
								if (formRef.current!.reportValidity()) {
									updateInfo.call({ info: userInfo, submit: false });
								}
							}}>
								Save
							</Button>
						</AppTooltip>
					</div>}
			</form>
			<Text v="dim">
				Last {data.submitted ? "submitted" : "saved"} at{" "}
				{new Date(data.lastEdited).toLocaleString()}
			</Text>
		</Card>

		<Card className="w-full max-w-2xl gap-3">
			<Text v="lg">Team management</Text>

			<Modal open={createTeamOpen} onClose={() => setCreateTeamOpen(false)} title="Create team">
				<form onSubmit={ev => {
					ev.preventDefault();
					if (ev.currentTarget.reportValidity()) {
						updateTeam.call({ name: createTeamName, logo: null });
						setCreateTeamOpen(false);
					}
				}} className="contents">
					<Text>Choose your team name</Text>
					<Input value={createTeamName} valueChange={v => setCreateTeamName(v)}
						pattern={validNameRe} />
					<Button>Create team</Button>
				</form>
			</Modal>

			<Modal open={joinTeamOpen} onClose={() => setJoinTeamOpen(false)} title="Join team">
				<form onSubmit={ev => {
					ev.preventDefault();
					if (ev.currentTarget.reportValidity()) {
						joinTeam.call({ joinCode: joinTeamCode });
						setJoinTeamOpen(false);
					}
				}} className="contents">
					<Text>Enter join code</Text>
					<Input value={joinTeamCode} valueChange={v => setJoinTeamCode(v)} pattern={joinCodeRe} />
					<Button>Join team</Button>
				</form>
			</Modal>

			{team
				? <div className="flex flex-col gap-3 max-w-xl">
					<div className="flex flex-col gap-1">
						<Text>Team name</Text>
						<Input disabled={loading} required {...teamNameValidity} pattern={validNameRe}
							onBlur={ev => {
								teamNameValidity.onBlur(ev);
								if (data?.team) updateTeam.call({ name: data.team?.name, logo: null });
							}} />
					</div>

					{team.logo == null
						// im not kidding without the key preact reorders them? what the fuck
						? <Text key="noLogo">No team logo set.</Text>
						: <div className="flex flex-col gap-2">
							<img src={new URL(team.logo, apiBaseUrl).href}
								className="max-h-32 object-contain rounded" />
							<Button onClick={() => updateTeam.call({ name: team.name, logo: "remove" })}>
								Remove logo
							</Button>
						</div>}

					<Text v="bold" className="-mb-2">Upload logo</Text>
					<Text className="-mb-1">
						Your image will be cropped to fit in a square. (Ideally, you should use a square image.)
					</Text>
					<div className="flex flex-row gap-2">
						<FileInput maxSize={logoMaxSize} mimeTypes={logoMimeTypes} onUpload={file => {
							void toBase64(file).then(base64 =>
								updateTeam.call({
									name: team.name,
									logo: { base64, mime: file.type as typeof logoMimeTypes[number] },
								})
							);
						}} />
						<GenerateTeamLogo refresh={infoCall} />
					</div>

					<Text v="bold" className="-mb-2">Join code</Text>
					<div className="flex flex-row gap-2 items-stretch">
						<Input readonly value={team.joinCode} onFocus={ev => {
							ev.currentTarget.setSelectionRange(0, ev.currentTarget.value.length);
						}} />
						<IconButton icon={IconClipboard} onClick={() => {
							void navigator.clipboard.writeText(team.joinCode).then(() =>
								toast("Join code copied")
							);
						}} className="h-auto" />
					</div>

					<Button loading={loading} className="mt-5 w-fit" onClick={() => {
						leaveTeam.call();
					}}>
						Leave team
					</Button>
				</div>
				: <div className="flex flex-row gap-2">
					<Button loading={loading} onClick={() => setCreateTeamOpen(true)}>Create team</Button>
					<Button loading={loading} onClick={() => setJoinTeamOpen(true)}>Join team</Button>
				</div>}
		</Card>

		<Card className="w-full max-w-2xl gap-3">
			<Text v="lg">Account settings</Text>
			<Text v="md">Change password</Text>
			<form onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					changePassword.call({ newPassword: newPass });
				}
			}} className="contents">
				<Input type="password" autocomplete="new-password" value={newPass}
					valueChange={v => setNewPass(v)} minLength={8} maxLength={100} />
				<Button className="w-fit">Change password</Button>
			</form>

			<Divider />
			<div className="flex flex-row gap-2">
				<Button onClick={() => {
					apiClient.logout();
					goto("/login");
				}}>
					Logout
				</Button>
				<Modal open={deleteUserOpen} onClose={() => setDeleteUserOpen(false)}
					title="Delete account?">
					<Text v="bold">Are you sure you want to delete your account?</Text>
					<Text>
						You can reuse your email for a new account by using the same verification email.
					</Text>
					<div className="flex flex-row gap-2">
						<Button className={bgColor.red} onClick={() => {
							setDeleteUserOpen(false);
							deleteUser.call();
						}}>
							Delete account
						</Button>
						<Button onClick={() => setDeleteUserOpen(false)}>Cancel</Button>
					</div>
				</Modal>

				<Button onClick={() => setDeleteUserOpen(true)}>Delete account</Button>
			</div>
		</Card>
	</MainContainer>;
}
