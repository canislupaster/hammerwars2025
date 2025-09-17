// hi i hope you enjoy my codebase
// have fun :) dont worry, i know...

import "disposablestack/auto";
import { IconChevronRight, IconMail } from "@tabler/icons-preact";
import { ComponentChildren, JSX, render } from "preact";
import { LocationProvider, Route, Router, useLocation, useRoute } from "preact-iso";
import { useCallback, useContext, useEffect, useErrorBoundary, useMemo, useRef,
	useState } from "preact/hooks";
import { twJoin, twMerge } from "tailwind-merge";
import { API, APIError, fill, joinCodeRe, logoMaxSize, logoMimeTypes, ServerResponse,
	stringifyExtra, UserInfo, validNameRe } from "../../shared/util";
import { apiBaseUrl, LocalStorage, useRequest } from "./clientutil";
import { Scoreboard } from "./scoreboard";
import { Alert, AlertErrorBoundary, Anchor, AppTooltip, bgColor, Button, Container, Divider,
	Dropdown, ease, GotoContext, HiddenInput, IconButton, Input, interactiveContainerDefault, Loading,
	Modal, Select, Text, Theme, ThemeContext, ThemeSpinner, throttle, useAsyncEffect, useGoto, useMd,
	useTitle, useValidity } from "./ui";

function Hero() {
	const container = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!container.current) return;
		const el = container.current;

		let frame: number | null = null;
		const reset = () => {
			const sz = 90,
				pad = 10,
				nx = Math.min(100, Math.ceil(el.clientWidth/sz)+2),
				ny = Math.min(100, Math.ceil(el.clientHeight/sz));
			const nodes = fill(ny, () =>
				fill(nx, () => {
					const box = document.createElement("div");
					box.style.width = box.style.height = `${sz-pad}px`;
					box.style.position = "absolute";
					return box;
				}));

			el.replaceChildren(...nodes.flat());
			const speeds = fill(2, fill(ny, () => Math.random()/5+0.1));
			const shiftOff = fill(2, () => fill(ny, () => 0));

			const brightness = fill(ny, () => fill(nx, () => 0));
			const flipped = fill(ny, () => fill(nx, () => Math.random() > 0.5));
			const pats = ["000111000", "010111010", "101010101", "010010010", "100010001", "001010100"]
				.map(p => fill(3, i => fill(3, j => p[i*3+j] == "1")));
			let activePats: { pat: boolean[][]; y: number; x: number; nextStep: number }[] = [];
			const newPatProb = 0.2, r = -Math.log(1-newPatProb), delay = 0.2;

			const w = el.clientWidth;
			const yOff = (ny*sz-el.clientHeight)/2;
			let last: number | null = null;
			const layout = (t: number) => {
				const sec = t/1000;
				const dt = last == null ? 0 : sec-last;
				if (Math.random() > Math.exp(-r*dt) || activePats.length == 0) {
					activePats.push({ pat: pats[4], y: Math.floor(Math.random()*ny), x: -2, nextStep: sec });
				}

				activePats = activePats.filter(pat => {
					if (pat.nextStep > sec) return true;

					for (let dx = 0; dx < 3; dx++) {
						for (let dy = 0; dy < 3; dy++) {
							if (pat.pat[dy][dx]) {
								const x = dx+pat.x, y = dy+pat.y;
								if (x >= 0 && x < nx && y >= 0 && y < ny) {
									flipped[y][x] = !flipped[y][x];
								}
							}
						}
					}

					pat.x++;
					pat.nextStep += delay;
					return pat.x < nx;
				});

				last = sec;

				const coeff = Math.exp(-dt*3);
				for (let j = 0; j < ny; j++) {
					let off = -2*sz;
					for (let l = 0; l <= 1; l++) {
						const shift = speeds[l][j]*sec-shiftOff[l][j];
						if (shift >= 1) {
							for (let i = nx-1; i >= 1; i--) {
								brightness[j][i] = brightness[j][i-1];
								flipped[j][i] = flipped[j][i-1];
							}
							flipped[j][0] = false;
							brightness[j][0] = 0;
							shiftOff[l][j]++;
						}
						off += sz*(l == 1 ? ease(shift%1) : shift%1);
					}

					for (let i = 0; i < nx; i++) {
						const l = i*sz+off;
						nodes[j][i].style.left = `${l}px`;
						nodes[j][i].style.top = `${j*sz-yOff}px`;
						const target = flipped[j][i] ? 1 : 0;
						brightness[j][i] = coeff*brightness[j][i]+(1-coeff)*target;
						nodes[j][i].style.background = `rgba(255,255,255,${brightness[j][i]*l/w})`;
					}
				}

				frame = requestAnimationFrame(nt => layout(nt));
			};

			if (frame != null) cancelAnimationFrame(frame);
			layout(performance.now());
		};

		const observer = new ResizeObserver(reset);
		observer.observe(el);
		return () => {
			observer.disconnect();
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, []);
	const goto = useGoto();
	const md = useMd();
	return <div className="w-full h-[30vh] relative">
		<div
			className={md
				? "z-50 flex flex-row justify-between px-10 items-center h-full"
				: "flex flex-col gap-5 items-center justify-center h-full"}>
			<div className="flex flex-col gap-4">
				<h1 className="md:text-6xl text-5xl z-20 animate-fade-in">
					HAMMERWARS<span className="font-black delay-300 animate-fade-in">2025</span>
				</h1>
				<p className="z-20 text-xl">
					The{" "}
					<span className="bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400 text-transparent font-bold">
						Purdue
					</span>{" "}
					programming contest.
				</p>
			</div>
			<div className={twJoin("flex flex-col gap-2 pt-2 items-center", md && "pr-20 pt-5")}>
				<Button
					className={twJoin(
						"z-50 rounded-none border-4 pr-1",
						md ? "text-3xl p-5" : "text-xl p-3 pr-0 py-1",
					)}
					onClick={() => goto("/register")}
					iconRight={<IconChevronRight size={48} />}>
					Register now
				</Button>
				<Text v="normal">Closes October 24th!</Text>
			</div>
		</div>
		<div className="absolute left-0 right-0 top-0 bottom-0 from-zinc-900 to-transparent bg-gradient-to-r z-10" />
		<div className="absolute left-0 right-0 top-0 bottom-0 overflow-hidden" ref={container} />
	</div>;
}

function Footer() {
	return <div className="flex flex-col items-center w-full pt-10 px-5">
		<Text v="sm">
			Created by the <Anchor href="https://purduecpu.com">Competitive Programmers Union</Anchor>
			{" "}
			at Purdue University.
		</Text>
		<img src="/cpu-logo.svg" className="max-h-[15dvh]" />
	</div>;
}

const squared = (x: ComponentChildren) =>
	<div className="flex flex-row gap-4 items-center relative">
		<div className="w-8 aspect-square bg-neutral-400 mb-1" />
		<div className="absolute my-auto left-10 w-8 aspect-square bg-neutral-400/30 mb-1" />
		<div className="absolute my-auto left-20 w-8 aspect-square bg-neutral-400/10 mb-1" />
		<div className="z-10">{x}</div>
	</div>;

const sectionStyle = (inv: boolean) =>
	twJoin(
		inv ? bgColor.secondary : "",
		"flex flex-col gap-2 items-start md:px-[20vw] px-5 w-full py-10",
	);

function Home() {
	return <>
		<Hero />

		<div className={sectionStyle(true)}>
			{squared(<Text v="big">A familiar contest.</Text>)}
			<p>
				<Text v="bold">5 hours. 12 problems. Teams of up to 3 people.</Text>
			</p>
			<p>
				Both online and physical participants will participate in the contest on DOMJudge, though
				physical participants will be on locked-down systems to preserve contest integrity. You'll
				also be given an hour to setup the systems and practice with unrestricted internet access.
			</p>
		</div>

		<div className={sectionStyle(false)}>
			{squared(<Text v="big">Prizes</Text>)}
			<p>
				Prizes will only be given to in-person participants. Each prize is{" "}
				<b>per person</b>, and if there are fewer than 3 people on a team, each person still
				receives the same amount. Team up!
			</p>
			{([["🥇 1st place", "$200 each"], ["🥈 2nd place", "$150 each"], [
				"🥉 3rd place",
				"$100 each",
			], ["🏆 4th-6th places", "$50 each"]] as const).map(([a, b], i) =>
				<p className="mt-3 md:px-10 px-5 font-bold text-lg" key={i}>{a}: {b}</p>
			)}
		</div>

		<div className={sectionStyle(true)}>{squared(<Text v="big">Schedule (tentative)</Text>)}</div>

		<div className={sectionStyle(false)}>{squared(<Text v="big">A HammerWars history</Text>)}</div>

		<Footer />
	</>;
}

function RegistrationEditor() {
	const [data, setData] = useState<API["getInfo"]["response"] | null>(null);
	const info = useRequest({
		route: "getInfo",
		initRequest: true,
		handler(res) {
			if (res.type == "ok") setData(res.data);
		},
	});

	const infoCall = info.call;
	const refresh = useCallback((x: ServerResponse<keyof API>) => {
		if (x.type == "ok") infoCall();
	}, [infoCall]);

	const updateInfo = useRequest({ route: "updateInfo", handler: refresh });

	const formRef = useRef<HTMLFormElement>(null);

	const updateTeam = useRequest({ route: "setTeam", handler: refresh });

	const joinTeam = useRequest({ route: "joinTeam", handler: refresh });
	const leaveTeam = useRequest({ route: "leaveTeam", handler: refresh });

	const teamNameValidity = useValidity(data?.team?.name ?? "", v => {
		if (data?.team) setData({ ...data, team: { ...data.team, name: v } });
	});

	const [createTeamOpen, setCreateTeamOpen] = useState(false);
	const [createTeamName, setCreateTeamName] = useState("");

	const [joinTeamOpen, setJoinTeamOpen] = useState(false);
	const [joinTeamCode, setJoinTeamCode] = useState("");
	const [logoError, setLogoError] = useState<string | null>(null);

	const loading = info.loading || updateInfo.loading || updateTeam.loading || leaveTeam.loading
		|| joinTeam.loading;
	const team = data?.team;

	if (data == null) return <Loading />;

	return <>
		<Text v="big">User information</Text>
		{data.submitted
			&& <Alert title="Unsubmit to edit your information" txt="Don't forget to resubmit!" />}
		<form ref={formRef} onSubmit={ev => {
			ev.preventDefault();
			if (!data.submitted && ev.currentTarget.reportValidity()) {
				updateInfo.call({ info: data.info, submit: true });
			}
		}}>
			{/* user info editing stuff */}
			{data.submitted
				? <Button loading={loading} onClick={() => {
					updateInfo.call({ info: data.info, submit: false });
				}}>
					Unsubmit
				</Button>
				: <div className="flex flex-row">
					<Button loading={loading} className={bgColor.green}>Submit</Button>
					<AppTooltip content="Use this option if you'd like to submit your information later.">
						<Button loading={loading} onClick={() => {
							if (formRef.current!.reportValidity()) {
								updateInfo.call({ info: data.info, submit: false });
							}
						}}>
							Save
						</Button>
					</AppTooltip>
				</div>}
		</form>
		<p>
			Last {data.submitted ? "submitted" : "saved"} at {new Date(data.lastEdited).toLocaleString()}
		</p>

		<Divider />

		<Text v="big">Team management</Text>

		<Modal open={createTeamOpen} onClose={() => setCreateTeamOpen(false)} title="Create team">
			<form onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					updateTeam.call({ name: createTeamName, logo: null });
					setCreateTeamOpen(false);
				}
			}}>
				<Text>Choose your team name</Text>
				<Input value={createTeamName} onInput={ev => setCreateTeamName(ev.currentTarget.value)}
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
			}}>
				<Text>Enter join code</Text>
				<Input value={joinTeamCode} onInput={ev => setJoinTeamCode(ev.currentTarget.value)}
					pattern={joinCodeRe} />
				<Button>Join team</Button>
			</form>
		</Modal>

		{team
			? <div>
				<Text>Team name</Text>
				<Input disabled={loading} {...teamNameValidity} pattern={validNameRe} onBlur={ev => {
					teamNameValidity.onBlur(ev);
					if (data?.team) updateTeam.call({ name: data.team?.name, logo: null });
				}} />
				{team.logo == null ? <Text>No team logo set.</Text> : <div>
					<img src={new URL(team.logo, apiBaseUrl).href} />
					<Button onClick={() => updateTeam.call({ name: team.name, logo: "remove" })}>
						Remove logo
					</Button>
				</div>}
				<Text>Upload logo</Text>

				<input className={interactiveContainerDefault} type="file" onInput={ev => {
					const file = ev.currentTarget.files?.[0];
					if (file) {
						if (!logoMimeTypes.includes(file.type as typeof logoMimeTypes[number])) {
							setLogoError(`Logo should be JPEG or PNG, not ${file.type}.`);
						} else if (file.size > logoMaxSize) {
							setLogoError(`Logo is > ${logoMaxSize/1024} MB, please choose something smaller`);
						} else {
							setLogoError(null);
							void file.arrayBuffer().then(buf => {
								updateTeam.call({
									name: team.name,
									logo: {
										base64: btoa(String.fromCharCode(...new Uint8Array(buf))),
										mime: file.type as typeof logoMimeTypes[number],
									},
								});
							});
						}
					}
				}} />

				{logoError != null && <Alert title="Invalid logo image" txt={logoError} />}

				<Button loading={loading} onClick={() => {
					leaveTeam.call();
				}}>
					Leave team
				</Button>
			</div>
			: <div>
				<Button loading={loading} onClick={() => setCreateTeamOpen(true)}>Create team</Button>
				<Button loading={loading} onClick={() => setJoinTeamOpen(true)}>Join team</Button>
			</div>}
	</>;
}

function RegisterPage() {
	const [email, setEmail] = useState("");
	const req = useRequest({ route: "register" });
	const goto = useGoto();

	const { call, current } = useRequest({ route: "checkSession" });
	const [noSession, setNoSession] = useState(false);
	useEffect(() => {
		if (LocalStorage.session != undefined) call();
		else setNoSession(true);
	}, [call]);

	return current?.type == "ok"
		? <RegistrationEditor />
		: current == null && !noSession
		? <Loading />
		: req.current?.type == "ok"
		? <div>
			<Text v="big">
				{req.current.data == "sent" ? "We sent you an email" : "We already sent an email"}
			</Text>
			{req.current.data == "alreadySent"
				&& <Text v="md">We aren't sending another! Check your junk, etc.</Text>}
			<IconMail size={64} />
			<Anchor onClick={() => req.reset()}>Try another email</Anchor>
		</div>
		: <div>
			please enter your email:
			{req.loading ? <Loading /> : <form onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					req.call({ email });
				}
			}}>
				Email:
				<Input value={email} onInput={ev => setEmail(ev.currentTarget.value)} type="email" />
				<Button type="submit">Register</Button>
			</form>}
			already have an account?
			<Anchor onClick={() => goto("/login")}>login instead</Anchor>
		</div>;
}

function VerifyPage() {
	const loc = useLocation();
	const { call, loading, ...verified } = useRequest({ route: "checkEmailVerify" });
	useEffect(() => {
		if (loc.query.id && isFinite(Number.parseInt(loc.query.id, 10)) && loc.query.key) {
			call({ id: Number.parseInt(loc.query.id, 10), key: loc.query.key });
		} else {
			throw new Error("Invalid verify URL");
		}
	}, [call, loc.query]);

	const [pass, setPass] = useState("");
	const goto = useGoto();
	const createAccReq = useRequest({
		route: "createAccount",
		handler(res) {
			if (res.type == "ok") {
				LocalStorage.session = res.data;
				goto("/register");
			}
		},
	});

	if (loading || createAccReq.loading) return <Loading />;
	if (verified.current == null || verified.current.type != "ok" || !verified.current.data) {
		return <ErrorPage errName="This verification link is invalid">
			<Text>Please contact us for support through our Discord.</Text>
		</ErrorPage>;
	}

	return <form onSubmit={ev => {
		ev.preventDefault();
		if (ev.currentTarget.reportValidity()) {
			createAccReq.call({ id: verified.request.id, key: verified.request.key, password: pass });
		}
	}}>
		<Text v="big">Just a few more steps</Text>
		enter your password
		<Input minLength={8} maxLength={100} type="password" value={pass}
			onInput={ev => setPass(ev.currentTarget.value)} />
		<Button type="submit">Register</Button>
		<Text v="dim">
			If you forget this, just reuse the link from your verification email to reset it.
		</Text>
	</form>;
}

function ErrorPage(
	{ errName, err, reset, children }: {
		errName?: string;
		err?: unknown;
		reset?: () => void;
		children?: ComponentChildren;
	},
) {
	useTitle("HammerWars | Error");

	return <div className="max-w-md flex flex-col w-full pt-20 gap-2">
		<Text v="big">{errName ?? "An error occurred"}</Text>
		{reset && <Text>
			Try refreshing, or click <Anchor onClick={() => reset()}>here</Anchor> to retry.
		</Text>}
		{err != undefined && <Text v="dim">Details: {err instanceof Error ? err.message : err}</Text>}
		<div>{children}</div>
	</div>;
}

function LoginPage({ failed, done }: { failed: boolean; done?: () => void }) {
	const [user, setUser] = useState("");
	const [pass, setPass] = useState("");
	const [incorrect, setIncorrect] = useState(false);

	const goto = useGoto();
	const login = useRequest({
		route: "login",
		handler(res) {
			if (res.type == "ok") {
				if (res.data == "incorrect") {
					setIncorrect(true);
					return;
				}
				LocalStorage.session = res.data;

				if (done) done();
				else goto("/register");
			}
		},
	});

	return <div>
		{failed
			&& <Alert bad title="You aren't authorized to do that"
				txt="Please login to an account with privileges." />}
		<Text v="big">Login</Text>
		<form onSubmit={ev => {
			ev.preventDefault();
			if (ev.currentTarget.reportValidity()) {
				login.call({ email: user, password: pass });
			}
		}}>
			<Input type="email" value={user} onInput={ev => setUser(ev.currentTarget.value)} />
			<Input type="password" minLength={8} maxLength={100} value={pass}
				onInput={ev => setPass(ev.currentTarget.value)} />
			<Button type="submit">Continue</Button>
			{incorrect
				&& <Alert bad title="Incorrect email or password"
					txt="Please try again. You can revisit the verification email to reset your password." />}
		</form>
	</div>;
}

function InnerApp() {
	const loc = useLocation();
	const [oldRoute, setOldRoute] = useState<string | null>(null);
	const errorShown = useRef(false);
	const errorPath = "/error";
	const [err, resetErr] = useErrorBoundary(err => {
		console.error("app error boundary", err);
		setOldRoute(loc.url);
		errorShown.current = true;
		loc.route(errorPath);
	}) as [Error | undefined, () => void];

	const retry = useCallback(() => {
		if (oldRoute != null) loc.route(oldRoute, true);
		resetErr();
	}, [loc, oldRoute, resetErr]);

	useEffect(() => {
		if (err == undefined) return;
		if (loc.path == errorPath) errorShown.current = true;
		else if (errorShown.current && loc.path != errorPath) retry();
	}, [err, loc.path, resetErr, retry]);

	if (err != undefined) {
		if (err instanceof APIError && err.error.type == "needLogin") {
			return <LoginPage failed done={retry} />;
		}
		return <ErrorPage err={err} reset={retry} />;
	}

	return <Router>
		<Route path="/" component={Home} />
		<Route path="/register" component={RegisterPage} />
		<Route path="/login" component={LoginPage} />
		<Route path="/verify" component={VerifyPage} />
		{/* <Route path="/scoreboard" component={Scoreboard} /> */}
		<Route default component={() =>
			<ErrorPage errName="Page not found">
				Go back <Anchor href="/">home</Anchor>.
			</ErrorPage>} />
	</Router>;
}

function App() {
	const route = useLocation();
	const [nextRoute, setNextRoute] = useState<string | null>(null);
	const routeTransitions = useRef<Set<() => Promise<void>>>(new Set());
	const gotoCtx = useMemo(
		() => ({
			goto: (x: string) => setNextRoute(x),
			addTransition: (t: () => Promise<void>) => {
				routeTransitions.current.add(t);
				return { [Symbol.dispose]: () => routeTransitions.current.delete(t) };
			},
		}),
		[],
	);

	useAsyncEffect(async () => {
		if (nextRoute == null) return;
		await Promise.all([...routeTransitions.current.values()].map(x => x()));
		route.route(nextRoute);
		setNextRoute(null);
	}, [nextRoute, route.route]);

	return <GotoContext.Provider value={gotoCtx}>
		<ThemeContext.Provider value={{ theme: "dark", setTheme() {} }}>
			<Container className="flex flex-col items-center">
				<InnerApp />
			</Container>
		</ThemeContext.Provider>
	</GotoContext.Provider>;
}

document.addEventListener("DOMContentLoaded", () => {
	render(
		<LocationProvider>
			<App />
		</LocationProvider>,
		document.body,
	);
});
