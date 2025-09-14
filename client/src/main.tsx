// hi i hope you enjoy my codebase
// have fun :) dont worry, i know...

import "disposablestack/auto";
import { IconChevronRight } from "@tabler/icons-preact";
import { ComponentChildren, JSX, render } from "preact";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { useContext, useEffect, useErrorBoundary, useMemo, useRef, useState } from "preact/hooks";
import { twJoin, twMerge } from "tailwind-merge";
import { fill } from "../../shared/util";
import { Anchor, bgColor, Button, Container, Dropdown, ease, GotoContext, HiddenInput, IconButton,
	Input, Select, Text, Theme, ThemeContext, useAsyncEffect, useGoto, useTitle } from "./ui";

function Home() {
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
			const speeds = fill(ny, () => Math.random()/3+0.2);
			const speeds2 = fill(ny, () => Math.random()/3+0.2);

			const brightness = fill(ny, () => fill(nx, () => 0));
			const pats = ["000111000", "010111010", "101010101", "010010010", "100010001", "001010100"]
				.map(p => fill(3, i => fill(3, j => p[i*3+j] == "1")));
			const activePats: { pat: boolean[][]; i: number; j: number } = [];
			const newPatProb = 0.1;

			const yOff = (ny*sz-el.clientHeight)/2;
			const layout = (t: number) => {
				const sec = t/1000;

				for (let i = 0; i < nx; i++) {
					for (let j = 0; j < ny; j++) {
						const off = sz*((speeds2[j]*sec)%1)+sz*ease((speeds[j]*sec)%1)-2*sz;
						nodes[j][i].style.left = `${i*sz+off}px`;
						nodes[j][i].style.top = `${j*sz-yOff}px`;
						nodes[j][i].style.background = `rgba(255,255,255,${brightness[j][i]})`;
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
	return <div className="w-full h-[30vh] relative">
		<div className="z-50 flex flex-row justify-between px-10 flex-wrap items-center h-full">
			<div className="flex flex-col gap-4">
				<h1 className="text-6xl z-20 animate-fade-in">
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
			<div className="flex flex-col gap-2 pt-10 items-center pr-20">
				<Button className="z-50 text-3xl p-5 rounded-none border-4 pr-1"
					onClick={() => goto("/register")} iconRight={<IconChevronRight size={48} />}>
					Register now
				</Button>
				<Text v="normal">Closes October 24th!</Text>
			</div>
		</div>
		<div className="absolute left-0 right-0 top-0 bottom-0 from-zinc-900 to-transparent bg-gradient-to-r z-10" />
		<div className="absolute left-0 right-0 top-0 bottom-0 overflow-hidden" ref={container} />
	</div>;
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

function InnerApp() {
	const [err, resetErr] = useErrorBoundary(err => {
		console.error("app error boundary", err);
	}) as [Error | undefined, () => void];

	if (err != undefined) return <ErrorPage err={err} reset={resetErr} />;

	return <Router>
		<Route path="/" component={Home} />
		<Route default component={() =>
			<ErrorPage errName="Page not found">
				Go back <Anchor href="/">home</Anchor>.
			</ErrorPage>} />
	</Router>;
}

function App({ theme: initialTheme }: { theme: Theme }) {
	const [theme, setTheme] = useState(initialTheme);

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
	}, [nextRoute, route.url, route.route]);

	return <GotoContext.Provider value={gotoCtx}>
		<ThemeContext.Provider value={{ theme, setTheme }}>
			<Container className="flex flex-col items-center">
				<InnerApp />
			</Container>
		</ThemeContext.Provider>
	</GotoContext.Provider>;
}

document.addEventListener("DOMContentLoaded", () => {
	render(
		<LocationProvider>
			<App theme={"dark"} />
		</LocationProvider>,
		document.body,
	);
});
