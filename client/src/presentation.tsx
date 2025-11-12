import { ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef,
	useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";

import { useLocation } from "preact-iso";
import { add, add3, mul, mul3, rot, V2, V3 } from "../../shared/geo";
import { badHash, delay, fill, PresentationState, Scoreboard } from "../../shared/util";
import { apiBaseUrl, apiClient } from "./clientutil";
import { CodeBlock } from "./code";
import { Pattern3, PatternBg } from "./home";
import ScoreboardPage from "./scoreboard";
import { Scroller, useScroll } from "./scroller";
import { bgColor, chipColorKeys, chipColors, Countdown, Loading, Text, useAsync,
	useTimeUntil } from "./ui";

function usePresentationTransition(
	{ start, hold, onDone, simple }: {
		start: number;
		hold?: boolean;
		onDone?: () => void;
		simple?: boolean;
	},
) {
	const ref = useRef<(SVGMaskElement | SVGGElement | null)[]>([null, null, null, null, null]);

	const transitionDur = 1000;
	useLayoutEffect(() => {
		const els1 = [...ref.current];
		if (els1.some(d => d == null)) return;
		const els = els1 as (SVGMaskElement | SVGGElement)[];
		const [fromMsk, fromSub, toMsk, toSub, group] = els;

		let frame: number | null = null;
		const sz = 100;
		const faceData = new Map<string, { from: number; rz: number; off: number }>();
		const getFace = (i: number, j: number) => {
			let v = faceData.get(`${i},${j}`);
			if (v == null) {
				v = {
					from: Math.floor(Math.random()*5),
					rz: Math.floor(Math.random()*4),
					off: Math.random()*.4,
				};
				faceData.set(`${i},${j}`, v);
			}
			return v;
		};
		const axDir = fill(3, ax => fill(3, i => i == ax ? 1 : 0) as V3);
		const faceCoords: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
		const faces = fill(3, ax =>
			fill(2, neg => {
				const ax1 = [1, 2, 0][ax], ax2 = [2, 0, 1][ax];
				return faceCoords.map(([u, v]) =>
					add3(add3(mul3(axDir[ax1], u), mul3(axDir[ax2], v)), mul3(axDir[ax], neg ? -1 : 1))
				);
			})).flat();
		const faceRot = [[1, -1], [1, 1], [0, -1], [0, 1], [
			Math.random() > .5 ? 0 : 1,
			Math.random() > .5 ? -2 : 2,
		]];
		const cb = (t: number) => {
			const s1 = hold == true ? 0 : Math.max(0, (t-start)/transitionDur);
			const s = s1 > 0.99 ? 1 : s1;
			const sc = 1-Math.pow(s-0.5, 2)*4;

			const svg = fromMsk.parentNode! as SVGSVGElement;
			const nx = Math.ceil(svg.clientWidth/sz)+2;
			const ny = Math.ceil(svg.clientHeight/sz)+2;

			const pathI = new Map(els.map(v => [v, { c: 0 }]));
			const addPath = (msk: SVGMaskElement | SVGGElement, pts: number[][]) => {
				const i = pathI.get(msk)!.c++;
				let x: SVGPathElement;
				if (i >= msk.children.length) {
					x = document.createElementNS("http://www.w3.org/2000/svg", "path");
					if (msk instanceof SVGMaskElement) {
						x.setAttribute("fill", "white");
					} else {
						x.setAttribute("stroke", "white");
						x.setAttribute("stroke-linecap", "round");
						x.setAttribute("stroke-width", "2");
					}
					msk.appendChild(x);
				} else {
					x = msk.children.item(i) as SVGPathElement;
				}
				const c = pts.map(a => `${a[0]},${a[1]}`);
				if (pts.length > 0) {
					x.setAttribute("d", ["M", c[0], ...c.slice(1).flatMap(v => ["L", v]), "Z"].join(""));
				} else x.removeAttribute("d");
				return x;
			};

			if (simple == true) {
				for (let i = 0; i < ny; i++) {
					for (let j = 0; j < nx; j++) {
						const off: V2 = [(j-1)*sz, (i-1)*sz];
						const d = (i+nx-1-j)/(ny+nx-2)-s;
						const w = .1;
						for (const from of [false, true]) {
							let dt = Math.max(Math.min(-d/w, 1), 0);
							if (from) dt = 1-dt;
							addPath(from ? fromMsk : toMsk, faceCoords.map(c => add(mul(c, dt*sz/2), off)));
						}
					}
				}
			} else {
				for (let i = 0; i < ny; i++) {
					for (let j = 0; j < nx; j++) {
						const info = getFace(i, j);
						let t = Math.max(0, (s-info.off)/(1-info.off));
						t = 1-Math.pow(1-t, 2);
						const mid = 1-Math.pow(0.5-t, 2)*4;
						const off: V2 = [(j-1)*sz, (i-1)*sz];
						const transform = (v: V3) => {
							const v2 = rot(
								rot(v, faceRot[info.from][0], faceRot[info.from][1]*t*Math.PI/2),
								2,
								t*info.rz*Math.PI/2,
							);
							return [...add(mul([v2[0], v2[1]], sz/2/(1+sc*(0.8+.5*v2[2]))), off), v2[2]];
						};
						const toPts = faces[info.from].map(transform);
						addPath(toMsk, toPts);
						const mskFrom = toPts.reduce((a, b) => a+b[2], 0)/toPts.length < 0;
						for (let fi = 0; fi < 6; fi++) {
							if (fi != info.from) {
								const pts = faces[fi].map(transform);
								addPath(fromMsk, pts);
								if (!mskFrom) addPath(toSub, pts);
								else addPath(toSub, []);
								addPath(group, pts).setAttribute("stroke-opacity", `${mid}`);
							}
						}

						if (mskFrom) addPath(fromSub, toPts);
						else addPath(fromSub, []);
					}
				}
			}

			for (const [k, v] of pathI) {
				if (v.c < k.children.length) {
					k.replaceChildren(...[...k.children].slice(0, v.c));
				}
			}

			if (hold != true) {
				if (s < 1) frame = requestAnimationFrame(cb);
				else onDone?.();
			}
		};
		cb(performance.now());
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, [hold, onDone, simple, start]);

	const fromId = useId(), fromSubId = useId(), toId = useId(), toSubId = useId();
	return { refs: ref, ids: { fromId, fromSubId, toId, toSubId } };
}

function PresentationTransition({ refs, ids }: ReturnType<typeof usePresentationTransition>) {
	const refSet = fill(5, i => (el: SVGMaskElement | SVGGElement | null) => {
		refs.current[i] = el;
	});
	return <svg className="absolute left-0 right-0 top-0 bottom-0 -z-10" width="100%" height="100%">
		{[ids.fromId, ids.fromSubId, ids.toId, ids.toSubId].map((id, i) =>
			<mask key={i} id={id} ref={refSet[i]} />
		)}
		<g ref={refSet[4]} key={4} />
	</svg>;
}

type Slide = Readonly<
	& { noTransition?: boolean }
	& (PresentationState & { type: "countdown" | "none" | "image" | "video" | "scoreboard" | "live" }
		| {
			type: "submission";
			scoreboard: Scoreboard;
			problemLabel: string;
			end: number;
			data: Readonly<
				(PresentationState & { type: "submissions" })["problems"][number]["solutions"][number]
			>;
		})
>;

async function controlPresentation(
	state: PresentationState,
	setSlide: (s: Slide) => void,
	abort: AbortSignal,
) {
	if (
		state.type == "countdown" || state.type == "image" || state.type == "video"
		|| state.type == "none" || state.type == "scoreboard" || state.type == "live"
	) {
		setSlide(state);
	} else if (state.type == "submissions") {
		const scoreboard = await apiClient.request("getScoreboard");
		const slides = state.problems.flatMap(prob =>
			prob.solutions.map(
				sol => ({ data: sol, problemLabel: prob.label, scoreboard, type: "submission" } as const)
			)
		);

		let i = 0;
		const slideDur = 20_000;
		while (!abort.aborted && slides.length > 0) {
			const slide = slides[(i++)%slides.length];
			setSlide({ ...slide, end: Date.now()+slideDur });
			await delay(slideDur, abort);
		}
	}
	if (!abort.aborted) {
		await new Promise(res => abort.addEventListener("abort", res));
	}
}

function PresentationCountdown({ slide }: { slide: Slide & { type: "countdown" } }) {
	const t = useTimeUntil(slide.to)!;
	return <div className="flex flex-col gap-3 justify-center items-center">
		<div className="flex flex-row items-start gap-3">
			{t < 0 && <span className="text-5xl">-</span>}
			<Countdown time={Math.abs(t)} />
		</div>
		<Text v="lg">{slide.title}</Text>
	</div>;
}

function SubmissionSlide({ slide }: { slide: Slide & { type: "submission" } }) {
	const probName = slide.scoreboard.problemNames.get(slide.problemLabel);
	const team = slide.scoreboard.teams.get(slide.data.team);
	const langColor = chipColors[chipColorKeys[badHash(slide.data.language)%chipColorKeys.length]];

	const timing = useMemo(() => {
		const dur = Math.max(2000, 100*[...slide.data.source.matchAll(/\n/g)].length);
		const slowDownPeriod = 500, frac = slowDownPeriod/dur;
		const a = .5/(frac*frac+2*frac*(.5-frac));
		const c = 2*a*frac;
		return { dur, frac, a, b: a*frac*frac-c*frac, c };
	}, [slide.data]);

	const [delayed, setDelayed] = useState<boolean>(true);
	useEffect(() => {
		const tm = setTimeout(() => setDelayed(false), 1000);
		return () => clearTimeout(tm);
	}, []);
	const scrollData = useScroll({
		dir: "vert",
		duration: timing.dur,
		delay: 0,
		stop: delayed,
		startDir: "forward",
		easeFn: useCallback((t: number) => {
			if (t < timing.frac) {
				return t*t*timing.a;
			} else if (1-t < timing.frac) {
				t = 1-t;
				return 1-t*t*timing.a;
			}
			return timing.b+timing.c*t;
		}, [timing]),
	});

	const progressRef = useRef<HTMLDivElement>(null);
	const endTime = slide.end;
	useEffect(() => {
		const start = Date.now();
		const d = progressRef.current;
		if (!d) return;
		const int = setInterval(() => {
			const prog = Math.min(100, (Date.now()-start)/(endTime-start)*100);
			d.style.width = `${prog}%`;
			if (prog >= 100) clearInterval(int);
		}, 1000/30);
		return () => clearInterval(int);
	}, [endTime]);

	return <div className="flex flex-col gap-1 h-full w-full max-w-5xl">
		<div className="flex flex-row justify-between items-baseline">
			<Text v="md">{slide.problemLabel}. {probName}</Text>
			<div className="flex flex-row gap-3 items-baseline">
				<Text v="md" className="animate-flip-in" key={slide.data.title}>{slide.data.title}</Text>
				<Text className={twJoin("px-2 py-1 rounded-md", langColor)} v="bold">
					{slide.data.language}
				</Text>
			</div>
		</div>
		<div className="self-start h-1 mt-1 bg-sky-400" ref={progressRef} />
		<div className="flex flex-col overflow-hidden relative">
			<Scroller data={scrollData} className="max-h-full relative pb-25">
				<CodeBlock className="grow" source={slide.data.source} language={slide.data.language} />
			</Scroller>
			{team
				&& <div className="flex flex-row items-center h-25 py-2 gap-4 absolute left-0 right-0 bottom-0 bg-black/80 z-30">
					{team.logo != null
						&& <img className="h-full animate-fade-in" src={new URL(team.logo, apiBaseUrl).href} />}
					<div className="flex flex-col items-start gap-1 max-h-full">
						<Text v="bold">by {team.name}</Text>
						<Text v="smbold">{team.members.join(", ")}</Text>
						<Text v="sm">{slide.data.summary}</Text>
					</div>
				</div>}
		</div>
	</div>;
}

function VideoSlide(
	{ slide, active }: { slide: Slide & { type: "video" | "live" }; active: boolean },
) {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const tm = setTimeout(() => ref.current!.play(), 500);
		return () => clearTimeout(tm);
	}, []);
	return <video src={slide.src} ref={ref} muted={!active} className="max-h-full max-w-full" />;
}

function PresentationSlide({ slide, active }: { slide: Slide; active: boolean }) {
	let inner: ComponentChildren;
	if (slide.type == "none") inner = <Text v="md">Please wait...</Text>;
	else if (slide.type == "countdown") inner = <PresentationCountdown slide={slide} />;
	else if (slide.type == "submission") inner = <SubmissionSlide slide={slide} />;
	else if (slide.type == "image") inner = <img src={slide.src} className="max-w-full max-h-full" />;
	else if (slide.type == "video" || slide.type == "live") {
		inner = <VideoSlide slide={slide} active={active} />;
	} else if (slide.type == "scoreboard") inner = <></>;
	else return slide.type satisfies never;
	return <div className="flex flex-col items-center justify-center w-full h-full">{inner}</div>;
}

function PresentationOverlay({ src, active }: { src: string; active: boolean }) {
	const [transitionStart, setStart] = useState<number>(0);
	useLayoutEffect(() => {
		const srcChange = active && last.current?.active == true && last.current.src != src;
		if (last.current == null || last.current.active != active || srcChange) {
			if (active) {
				setState(
					o => [
						o[0]+(srcChange ? 1 : 0),
						src,
						last.current?.active == true ? last.current.src : null,
					]
				);
			}
			setStart(performance.now()+500);
		}
		last.current = { src, active };
	}, [active, src]);
	const transition = usePresentationTransition({ simple: true, start: transitionStart });
	const last = useRef<{ src: string; active: boolean } | null>(null);
	const [state, setState] = useState<[number, string, string | null]>([0, src, null]);

	return <div className="absolute left-10 bottom-30 drop-shadow-black drop-shadow-xl">
		<video key={state[0]+1} src={state[1]} muted autoplay className="max-w-[580px]"
			style={{
				maskImage: active
					? `url("#${transition.ids.toId}"), url("#${transition.ids.toSubId}")`
					: `url("#${transition.ids.fromId}"), url("#${transition.ids.fromSubId}")`,
			}} />
		<video key={state[0]} src={state[2] ?? undefined} muted autoplay
			className="max-w-[580px] absolute top-0 left-0"
			style={{ maskImage: `url("#${transition.ids.fromId}"), url("#${transition.ids.fromId}")` }} />
		<PresentationTransition {...transition} />
	</div>;
}

export default function Presentation() {
	const [transitionParam, setTransitionParam] = useState<{ start: number; hold: boolean }>(() => ({
		start: performance.now(),
		hold: true,
	}));
	const [slides, setSlides] = useState<[number, Slide[]]>([0, []]);
	const { refs, ids } = usePresentationTransition({
		...transitionParam,
		onDone: useCallback(() => {
			if (slides[1].length >= 2) {
				setTransitionParam({ start: performance.now(), hold: true });
				setSlides(sl => [sl[0]+1, sl[1].slice(1)]);
			}
		}, [slides]),
	});

	const setSlide = useCallback((s2: Slide) => {
		if (s2.noTransition == true) {
			setSlides(s => [s[0], [...s[1].slice(0, s[1].length-1), s2]]);
		} else {
			setSlides(s => [s[0], [...s[1].slice(0, 2), s2]]);
		}
	}, []);
	useEffect(() => {
		if (slides[1].length >= 2 && transitionParam.hold) {
			setTransitionParam({ start: performance.now(), hold: false });
		}
	}, [slides, transitionParam.hold]);

	const loc = useLocation();
	const isLive = "live" in loc.query;
	const [overlay, setOverlay] = useState<{ src: string; active: boolean } | null>(null);

	const fun = useAsync(useCallback(async (abort: AbortSignal) => {
		let lastControl: [Promise<void>, AbortController] | null = null;
		for await (const s of apiClient.feed("presentation", { live: isLive }, abort)) {
			if (lastControl != null) {
				lastControl[1].abort();
				await lastControl[0];
			}
			setOverlay(old =>
				s.liveOverlaySrc != null
					? { src: s.liveOverlaySrc, active: true }
					: old
					? { src: old.src, active: false }
					: null
			);
			if (s.onlyOverlayChange != true) {
				const abort2 = new AbortController();
				const prom = controlPresentation(s, setSlide, abort2.signal);
				lastControl = [prom, abort2];
			}
		}
		if (lastControl != null) {
			lastControl[1].abort();
			await lastControl[0];
		}
	}, [isLive, setSlide]));

	const abortRef = useRef<AbortController>(null);
	useEffect(() => {
		abortRef.current = new AbortController();
		return () => abortRef.current?.abort();
	}, []);
	useEffect(() => {
		if (!fun.loading && abortRef.current) fun.run(abortRef.current.signal);
	}, [fun]);

	if (slides[1].length == 1 && slides[1][0].type == "scoreboard") {
		return <ScoreboardPage />;
	}

	const last = slides[1][slides[1].length-1] ?? null;
	const logo = last != null && last.type == "video" && last.logo;
	const live = last != null && last.type == "live";

	return <>
		<div
			className={twJoin(
				"flex flex-col gap-8 h-dvh justify-center items-center transition-transform duration-1000",
				overlay?.active == true && "scale-75 translate-y-[-150px] translate-x-[350px]",
			)}>
			<div
				className={twJoin(
					"z-10 transition-transform duration-1000",
					overlay?.active == true && "translate-y-[10px]",
				)}>
				{logo != null && logo != false
					? <img src={logo} className="drop-shadow-lg/100 drop-shadow-black max-h-18" />
					: <h1 className="text-5xl flex flex-row items-center drop-shadow-lg/100 drop-shadow-black">
						<span>HAMMERWARS</span>
						<span className="font-black">2025</span>
						{live && <>
							<span
								className={twJoin(
									"ml-10 rounded-full mb-1 animate-pulse h-10 shrink-0 aspect-square",
									bgColor.red,
								)} />
							<Text className="text-4xl ml-2" v="bold">LIVE</Text>
						</>}
					</h1>}
			</div>
			<div className="relative w-[90vw] h-[80vh]">
				<div className="absolute w-[95%] ml-[2.5%] shadow-[0_0_50px_50px] bg-black/70 h-[102%] bottom-[5%] shadow-black/70" />
				{slides[1].length == 0
					? <Loading />
					: <div key={slides[0]}
						className={twJoin(
							"absolute left-0 right-0 top-0 bottom-0 z-20",
							slides[1].length > 1 && "mask-subtract animate-fade-out",
						)} style={slides[1].length == 1
						? undefined
						: { maskImage: `url("#${ids.fromId}"), url("#${ids.fromSubId}")` }}>
						<PresentationSlide slide={slides[1][0]} active={slides[1].length == 1} />
					</div>}
				{slides[1].length > 1
					&& <div key={slides[0]+1}
						className="absolute left-0 right-0 top-0 bottom-0 z-10 mask-subtract animate-fade-in"
						style={{ maskImage: `url("#${ids.toId}"), url("#${ids.toSubId}")` }}>
						<PresentationSlide slide={slides[1][1]} active={true} />
					</div>}
				<PresentationTransition refs={refs} ids={ids} />
			</div>
		</div>
		{overlay && <PresentationOverlay {...overlay} />}
		<PatternBg pat={() => new Pattern3()} uniformVelocity flipAnim velocity={0.5} />
	</>;
}
