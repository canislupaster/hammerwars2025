import "disposablestack/auto";
import { IconMail } from "@tabler/icons-preact";
import { ComponentChildren, render } from "preact";
import { lazy, LocationProvider, Route, Router, useLocation } from "preact-iso";
import { useCallback, useEffect, useErrorBoundary, useMemo, useRef, useState } from "preact/hooks";
import { twMerge } from "tailwind-merge";
import { APIError } from "../../shared/util";
import { LocalStorage, useRequest } from "./clientutil";
import { Home } from "./home";
import { Alert, Anchor, Button, Card, Container, GotoContext, Input, Loading, Text, ThemeContext,
	useGoto, useTitle } from "./ui";

export function Footer() {
	return <div className="flex flex-col items-center w-full py-5 px-5">
		<Text v="sm" className="text-center">
			Created by the <Anchor href="https://purduecpu.com">Competitive Programmers Union</Anchor>
			{" "}
			at Purdue University.
		</Text>
		<img src="/cpu-logo.svg" className="max-h-[15dvh]" />
	</div>;
}

export function MainContainer(
	{ children, className }: { children?: ComponentChildren; className?: string },
) {
	const goto = useGoto();
	return <>
		<div className="flex flex-row mt-10 relative cursor-pointer" onClick={() => {
			goto("/");
		}}>
			<div className="block-anim" />
			<h1 className="md:text-4xl text-2xl flex flex-row">
				<span className="block animate-flip-in">HAMMERWARS</span>
				<span className="block font-black anim-delay animate-flip-in">2025</span>
			</h1>
		</div>
		<div
			className={twMerge(
				"my-5 max-w-xl w-full flex flex-col items-center gap-3 p-1 px-2",
				className,
			)}>
			{children}
		</div>
		<Footer />
	</>;
}

const LazyRegistration = lazy(() => import("./registration").then(a => a.default));

export function useLoggedIn() {
	const { call, current } = useRequest({ route: "checkSession", throw: false });
	const [noSession, setNoSession] = useState(false);
	useEffect(() => {
		if (LocalStorage.session != undefined) call();
		else setNoSession(true);
	}, [call]);
	return { loggedIn: current?.type == "ok", loading: current == null && !noSession };
}

function RegisterPage() {
	const [email, setEmail] = useState("");
	const req = useRequest({ route: "register" });
	const goto = useGoto();
	const loggedIn = useLoggedIn();

	return loggedIn.loggedIn
		? <LazyRegistration />
		: loggedIn.loading
		? <Loading />
		: req.current != null && req.current.type == "ok"
		? <MainContainer>
			<div className="flex flex-col items-start gap-3">
				<Text v="md">
					{req.current.data == "sent" ? "We sent you an email" : "We already sent an email"}
				</Text>
				{req.current.data == "alreadySent"
					&& <Text>We aren't sending another! Check your junk, etc.</Text>}
				<Text>
					Sent to <b>{req.request.email}</b>.{" "}
					<Anchor onClick={() => req.reset()}>Try another email.</Anchor>
				</Text>
				<div className="max-w-40 self-center">
					<IconMail size="auto" />
				</div>
			</div>
		</MainContainer>
		: <MainContainer>
			<Card className="w-full max-w-md gap-3">
				<Text v="big" className="self-center">Register</Text>
				{req.loading ? <Loading /> : <form onSubmit={ev => {
					ev.preventDefault();
					if (ev.currentTarget.reportValidity()) {
						req.call({ email });
					}
				}} className="flex flex-col gap-3">
					<Text v="smbold">Email</Text>
					<Text v="dim" className="-mt-2">
						Try using your personal email if you don't receive the verification link in your school
						email.
					</Text>
					<Input value={email} valueChange={v => setEmail(v)} type="email" required />
					<Button>Register</Button>
				</form>}
				<Text v="sm">
					Already have an account?{" "}
					<Anchor onClick={() => {
						LocalStorage.loginRedirect = "register";
						goto("/login");
					}}>
						Login instead
					</Anchor>
				</Text>
			</Card>
		</MainContainer>;
}

export function useEmailVerification() {
	const loc = useLocation();
	const { call, ...verified } = useRequest({ route: "checkEmailVerify" });
	const [invalidParams, setInvalidParams] = useState(false);
	useEffect(() => {
		if ("id" in loc.query && isFinite(Number.parseInt(loc.query.id, 10)) && "key" in loc.query) {
			setInvalidParams(false);
			call({ id: Number.parseInt(loc.query.id, 10), key: loc.query.key });
		} else {
			setInvalidParams(true);
		}
	}, [call, loc.query]);

	return {
		invalid: invalidParams || verified.current != null && !verified.current.data,
		loading: verified.request == null && !invalidParams,
		req: verified.request,
	};
}

function VerifyPage() {
	const [pass, setPass] = useState("");
	const goto = useGoto();
	const createAccReq = useRequest({
		route: "createAccount",
		handler(res) {
			if (res.type == "ok") {
				goto("/register");
			}
		},
	});

	const verified = useEmailVerification();
	const r = verified.req;

	if (verified.loading || createAccReq.loading) return <Loading />;
	if (verified.invalid || r == null) {
		return <ErrorPage errName="This verification link is invalid">
			<Text>Please contact us for support through our Discord.</Text>
		</ErrorPage>;
	}

	return <MainContainer>
		<Card className="w-full max-w-md gap-3">
			<form onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					createAccReq.call({ id: r.id, key: r.key, password: pass });
				}
			}} className="flex flex-col gap-3">
				<Text v="big">Set your password</Text>
				<Text v="smbold">Password</Text>
				<Input minLength={8} maxLength={100} autoComplete="new-password" type="password"
					value={pass} valueChange={v => setPass(v)} />
				<Button>Register</Button>
				<Text v="dim">
					If you forget this, just reuse the link from your verification email to reset it.
				</Text>
			</form>
		</Card>
	</MainContainer>;
}

export function ErrorPage(
	{ errName, err, reset, children }: {
		errName?: string;
		err?: unknown;
		reset?: () => void;
		children?: ComponentChildren;
	},
) {
	useTitle("HammerWars | Error");

	return <MainContainer>
		<Text v="big">{errName ?? "An error occurred"}</Text>
		{reset && <Text>
			Try refreshing, or click <Anchor onClick={() => reset()}>here</Anchor> to retry.
		</Text>}
		{err != undefined && <Text v="dim">Details: {err instanceof Error ? err.message : err}</Text>}
		<div>{children}</div>
	</MainContainer>;
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

				if (done) done();
				else {
					const r = LocalStorage.loginRedirect;
					LocalStorage.loginRedirect = undefined;
					goto(`/${r ?? "register"}`);
				}
			}
		},
	});

	return <MainContainer>
		<Card className="w-full max-w-md gap-3">
			{failed
				&& <Alert bad title="You aren't authorized to do that"
					txt="Please login to an account with privileges." />}
			<Text v="big" className="self-center">Login</Text>
			<form onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					login.call({ email: user, password: pass });
				}
			}} className="flex flex-col gap-3">
				<Text v="smbold">Email</Text>
				<Input type="email" value={user} valueChange={v => setUser(v)} required />
				<Text v="smbold">Password</Text>
				<Input type="password" autoComplete="current-password" minLength={8} maxLength={100}
					value={pass} valueChange={v => setPass(v)} required />
				<Button>Continue</Button>
				{incorrect
					&& <Alert bad title="Incorrect email or password"
						txt="Please try again. You can revisit the verification email to reset your password." />}
			</form>
		</Card>
	</MainContainer>;
}

const LazyScoreboardPage = lazy(() => import("./scoreboard").then(v => v.default));
const LazyPresentationPage = lazy(() => import("./presentation").then(v => v.default));
const LazyClickerPage = lazy(() => import("./clicker").then(v => v.default));
const LazySubmissionsPage = lazy(() => import("./submissions").then(v => v.default));
const LazyConfirmAttendance = lazy(() => import("./confirm").then(v => v.default));

const NotFound = () =>
	<ErrorPage errName="Not found">
		Go back <Anchor href="/">home</Anchor>.
	</ErrorPage>;

function InnerApp() {
	const loc = useLocation();
	const [oldRoute, setOldRoute] = useState<string | null>(null);
	const errorShown = useRef(false);
	const errorPath = "/error";

	const [err, resetErr] = useErrorBoundary(err => {
		console.error("app error boundary", err);
		if (import.meta.env.DEV) return;

		setOldRoute(loc.url);
		loc.route(errorPath);
	}) as [Error | undefined, () => void];

	const retry = useCallback(() => {
		if (oldRoute != null) loc.route(oldRoute, true);
		resetErr();
	}, [loc, oldRoute, resetErr]);

	useEffect(() => {
		if (err == undefined) return;
		if (loc.path == errorPath) errorShown.current = true;
		else if (errorShown.current && loc.path != errorPath) resetErr();
	}, [err, loc.path, resetErr, retry]);

	if (err != undefined) {
		if (err instanceof APIError && err.error.type == "needLogin") {
			return <LoginPage failed done={retry} />;
		}
		return <ErrorPage err={err} reset={retry}>
			Go back <Anchor href="/">home</Anchor>.
		</ErrorPage>;
	}

	return <Router>
		<Route path="/" component={Home} />
		<Route path="/register" component={RegisterPage} />
		<Route path="/confirm" component={LazyConfirmAttendance} />
		<Route path="/login" component={LoginPage} />
		<Route path="/verify" component={VerifyPage} />
		<Route path="/scoreboard" component={LazyScoreboardPage} />
		<Route path="/presentation" component={LazyPresentationPage} />
		<Route path="/clicker" component={LazyClickerPage} />
		<Route path="/submissions" component={LazySubmissionsPage} />
		<Route path="/submissions/:problem" component={LazySubmissionsPage} />
		<Route path="/submissions/:problem/:team" component={LazySubmissionsPage} />
		<Route default component={NotFound} />
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

	const goto = route.route;
	useEffect(() => {
		if (nextRoute == null) return;
		let active = true;
		void Promise.all([...routeTransitions.current.values()].map(x => x())).finally(() => {
			if (!active) return;
			goto(nextRoute);
			setNextRoute(null);
		});
		return () => {
			active = false;
		};
	}, [goto, nextRoute]);

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
