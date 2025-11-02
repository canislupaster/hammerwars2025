import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { add, add3, mul, mul3, rot, V2, V3 } from "../../shared/geo";
import { fill, forever, PresentationState } from "../../shared/util";
import { apiClient } from "./clientutil";
import { Pattern3, PatternBg } from "./home";
import { Countdown, Loading, Text, useAsync, useTimeUntil } from "./ui";

function usePresentationTransition(
	{ start, hold, onDone }: { start: number; hold?: boolean; onDone: () => void },
) {
	const ref = useRef<(SVGMaskElement | SVGGElement | null)[]>([null, null, null, null, null]);

	const transitionDur = 1000;
	useEffect(() => {
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
			const nx = Math.ceil(svg.clientWidth/sz)+1;
			const ny = Math.ceil(svg.clientHeight/sz)+1;

			const pathI = new Map(els.map(v => [v, { c: 0 }]));
			for (let i = 0; i < ny; i++) {
				for (let j = 0; j < nx; j++) {
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
						x.setAttribute("d", ["M", c[0], ...c.slice(1).flatMap(v => ["L", v]), "Z"].join(""));
						return x;
					};

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

			for (const [k, v] of pathI) {
				if (v.c < k.children.length) {
					k.replaceChildren(...[...k.children].slice(0, v.c));
				}
			}

			if (hold != true) {
				if (s < 1) frame = requestAnimationFrame(cb);
				else onDone();
			}
		};
		cb(performance.now());
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, [hold, onDone, start]);

	return ref;
}

type Slide = { noTransition?: boolean } & (PresentationState & { type: "countdown" | "none" });

async function controlPresentation(
	state: PresentationState,
	setSlide: (s: Slide) => void,
	_abort: AbortSignal,
) {
	if (state.type == "countdown") setSlide(state);
	await forever;
}

function PresentationCountdown({ slide }: { slide: Slide & { type: "countdown" } }) {
	const t = useTimeUntil(slide.to)!;
	return <div className="flex flex-col gap-3 justify-center items-center mt-[10%]">
		<div className="flex flex-row items-start gap-3">
			{t < 0 && <span className="text-5xl">-</span>}
			<Countdown time={Math.abs(t)} />
		</div>
		<Text v="lg">{slide.title}</Text>
	</div>;
}

function PresentationSlide({ slide }: { slide: Slide }) {
	if (slide.type == "none") return <Text v="md">Please wait...</Text>;
	else if (slide.type == "countdown") {
		return <PresentationCountdown slide={slide} />;
	}
	slide satisfies never;
}

export default function Presentation() {
	const [transitionParam, setTransitionParam] = useState<{ start: number; hold: boolean }>(() => ({
		start: performance.now(),
		hold: true,
	}));
	const [slides, setSlides] = useState<[number, Slide[]]>([0, []]);
	const ref = usePresentationTransition({
		...transitionParam,
		onDone: useCallback(() => {
			if (slides[1].length >= 2) {
				setTransitionParam({ start: performance.now(), hold: true });
				setSlides(sl => [sl[0]+1, sl[1].slice(1)]);
			}
		}, [slides]),
	});
	const fromId = useId(), fromSubId = useId(), toId = useId(), toSubId = useId();
	const refSet = fill(5, i => (el: SVGMaskElement | SVGGElement | null) => {
		ref.current[i] = el;
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

	const fun = useAsync(useCallback(async (abort: AbortSignal) => {
		let lastControl: [Promise<void>, AbortController] | null = null;
		for await (const s of apiClient.feed("presentation", abort)) {
			if (lastControl != null) {
				lastControl[1].abort();
				await lastControl[0];
			}
			const abort2 = new AbortController();
			const prom = controlPresentation(s, setSlide, abort2.signal);
			lastControl = [prom, abort2];
		}
		if (lastControl != null) {
			lastControl[1].abort();
			await lastControl[0];
		}
	}, [setSlide]));

	const abortRef = useRef<AbortController>(null);
	useEffect(() => {
		abortRef.current = new AbortController();
		return () => abortRef.current?.abort();
	}, []);
	useEffect(() => {
		if (!fun.loading && abortRef.current) fun.run(abortRef.current.signal);
	}, [fun]);

	return <div className="flex flex-col gap-8 h-dvh justify-center items-center">
		<h1 className="text-5xl flex flex-row">
			<span>HAMMERWARS</span>
			<span className="font-black">2025</span>
			{/* <span className="inline-block w-[100px] shrink-0" /> */}
			{/* <span className="ml-auto"></span> */}
		</h1>
		<div className="relative w-[90vw] h-[80vh]">
			{slides[1].length == 0
				? <Loading />
				: <div key={slides[0]}
					className={twJoin(
						"absolute left-0 right-0 top-0 bottom-0 z-20",
						slides[1].length > 1 && "mask-subtract animate-fade-out",
					)} style={slides[1].length == 1
					? undefined
					: { maskImage: `url("#${fromId}"), url("#${fromSubId}")` }}>
					<PresentationSlide slide={slides[1][0]} />
				</div>}
			{slides[1].length > 1
				&& <div key={slides[0]+1}
					className="absolute left-0 right-0 top-0 bottom-0 z-10 mask-subtract animate-fade-in"
					style={{ maskImage: `url("#${toId}"), url("#${toSubId}")` }}>
					<PresentationSlide slide={slides[1][1]} />
				</div>}
			<svg className="absolute left-0 right-0 top-0 bottom-0 -z-10" width="100%" height="100%">
				{[fromId, fromSubId, toId, toSubId].map((id, i) =>
					<mask key={i} id={id} ref={refSet[i]} />
				)}
				<g ref={refSet[4]} key={4} />
			</svg>
		</div>
		<PatternBg pat={() => new Pattern3()} uniformVelocity flipAnim velocity={0.5} />
	</div>;
}
