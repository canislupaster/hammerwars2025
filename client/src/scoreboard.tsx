import { IconCheck, IconX } from "@tabler/icons-preact";
import { ComponentChildren } from "preact";
import { Dispatch, StateUpdater, useCallback, useEffect, useMemo, useRef,
	useState } from "preact/hooks";
import { twJoin, twMerge } from "tailwind-merge";
import { cmpTeamRankId, ContestProperties, fill, Scoreboard, ScoreboardLastSubmission,
	ScoreboardTeam, throttle } from "../../shared/util";
import { apiBaseUrl, apiKeyClient, LocalStorage, useFeed } from "./clientutil";
import { Pattern2, PatternBg } from "./home";
import { Button, chipColorKeys, chipTextColors, Countdown, Divider, ease, Input, Loading, Modal, px,
	Text, ThemeSpinner, useAsync, useDisposable, useShortcuts, useTimeUntil } from "./ui";

type ScrollData = { addScroller: (x: HTMLElement, off: number) => () => void };

type ScrollTarget = { offsets: HTMLElement[]; subOffset: HTMLElement } | null;

function useScroll(
	{ duration, delay, delayBack, el, dir: orient, syncScroll }: {
		duration?: number;
		delay?: number;
		delayBack?: number;
		dir: "vert" | "horiz";
		el?: HTMLElement | null;
		syncScroll?: boolean;
	},
): ScrollData {
	const [dir, setDir] = useState<"forward" | "reverse">("reverse");
	const [target, setTarget] = useState<ScrollTarget>(null);

	type Data = {
		scrollers: Map<HTMLElement, { off: number; inner: number; sz: number; init?: number }>;
		active: Set<HTMLElement>;
	};
	const dataRef = useRef<Data>({ scrollers: new Map(), active: new Set() });

	const scrollDuration = duration ?? 1000,
		scrollDelay = (dir == "forward" ? (delayBack ?? delay) : delay) ?? 3000;

	const modScrollers = useCallback(() => {
		let el2: HTMLElement | null | undefined = el;

		if (el2 != null) {
			let p: HTMLElement | null = null;
			const offsetEls: HTMLElement[] = [];
			while (el2 != null && !dataRef.current.scrollers.has(el2)) {
				if (el2.offsetParent != p) {
					offsetEls.push(el2);
					p = el2.offsetParent as HTMLElement | null;
				}
				el2 = el2.parentElement;
			}
			if (el2 != null) setTarget({ offsets: offsetEls, subOffset: el2 });
		}

		if (el2 == null) {
			setTarget(null);
		}
	}, [el]);

	useEffect(() => modScrollers(), [modScrollers]);

	useEffect(() => {
		if (target != null) return;
		const tm = setTimeout(() => {
			setDir(dir == "forward" ? "reverse" : "forward");
		}, scrollDelay+scrollDuration);
		return () => clearTimeout(tm);
	}, [dir, scrollDelay, scrollDuration, target]);

	useEffect(() => {
		for (const [e, v] of dataRef.current.scrollers) {
			delete v.init;
			if (syncScroll == true) {
				e.style.overflow = "scroll";
				e.style.scrollbarWidth = "none";
			} else {
				e.style.overflow = "hidden";
			}
		}

		const prop = orient == "vert" ? "scrollTop" : "scrollLeft";
		const setMask = (d: HTMLElement, dim: { inner: number; sz: number }) => {
			const a = 5*d[prop]/Math.max(1, dim.inner-dim.sz);
			d.style.maskImage = `linear-gradient(to ${
				orient == "vert" ? "bottom" : "right"
			}, transparent 0%, black ${a}%, black ${100-(5-a)}%, transparent 100%)`;
		};

		if (syncScroll == true) {
			const scrollCb = (event: Event) => {
				const el = event.target as HTMLElement;
				const dim = dataRef.current.scrollers.get(el);
				if (dim == undefined) return;
				const prog = el[prop]/Math.max(1, dim.inner-dim.sz);
				for (const [scroller, dim2] of dataRef.current.scrollers) {
					scroller[prop] = Math.max(0, dim2.inner-dim2.sz)*prog;
					setMask(scroller, dim2);
				}
			};

			document.addEventListener("scroll", scrollCb, true);
			return () => {
				document.removeEventListener("scroll", scrollCb, true);
			};
		}

		let frame: number | null = null;

		const start = performance.now();
		dataRef.current.active = new Set([...dataRef.current.scrollers.keys()]);

		const cb = (t: number) => {
			let sharedTarget: number | null = null;
			if (target != null) {
				let offset = 0;
				const offProp = orient == "vert" ? "offsetTop" : "offsetLeft";
				for (const el of target.offsets) offset += el[offProp];
				offset -= target.subOffset[offProp];
				sharedTarget = offset;
			}

			for (const d of dataRef.current.active) {
				const dim = dataRef.current.scrollers.get(d)!;
				if (dim.inner <= dim.sz) {
					d.style.maskImage = "";
					dataRef.current.active.delete(d);
					continue;
				}

				if (dim.init == undefined) {
					dim.init = d[prop];
				}

				const to = sharedTarget != null
					? Math.max(Math.min(dim.inner-dim.sz, sharedTarget-dim.sz/2), 0)
					: (dir == "forward" ? dim.inner-dim.sz : 0);

				const start2 = target != null ? start : start+dim.off*scrollDelay;
				const dt = Math.min(1, Math.max(0, (t-start2)/scrollDuration));
				const e = ease(dt);
				d[prop] = e*to+dim.init*(1-e);
				setMask(d, dim);

				if (dt >= 1 && sharedTarget == null) {
					dataRef.current.active.delete(d);
					continue;
				}
			}

			frame = requestAnimationFrame(cb);
		};
		frame = requestAnimationFrame(cb);

		return () => {
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, [dir, orient, scrollDelay, scrollDuration, syncScroll, target]);

	return {
		addScroller: useCallback((x: HTMLElement, off: number) => {
			const up = () => {
				const v = {
					off,
					sz: orient == "vert" ? x.clientHeight : x.clientWidth,
					inner: orient == "vert" ? x.scrollHeight : x.scrollWidth,
				};

				dataRef.current.scrollers.set(x, v);
				dataRef.current.active.add(x);
			};
			const obs = new ResizeObserver(up);
			up();
			modScrollers();
			obs.observe(x);
			return () => {
				obs.disconnect();
				dataRef.current.scrollers.delete(x);
			};
		}, [modScrollers, orient]),
	};
}

function Scroller(
	{ children, className, off, data: { addScroller } }: {
		children?: ComponentChildren;
		className?: string;
		off?: number;
		data: ScrollData;
	},
) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const d = ref.current!;
		return addScroller(d, off ?? 0);
	}, [addScroller, off]);

	return <div className={className} data-scroll ref={ref}>{children}</div>;
}

const rowBorder = "border-b-2 box-border border-neutral-800";
const highlightBg = "theme:bg-amber-400/90 theme:text-black";

function useChanged(dur: number, ...values: unknown[]) {
	const [ret, setRet] = useState<boolean>(false);
	const init = useRef(false);
	useEffect(() => {
		if (!init.current) {
			init.current = true;
			return;
		}
		setRet(true);
		const tm = setTimeout(() => setRet(false), dur);
		return () => clearTimeout(tm);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, values);
	return ret;
}

function useAnimDelay(dur: number, flag: boolean) {
	const [ret, setRet] = useState<{ animationDelay?: string }>({});
	useEffect(() => {
		setRet(flag ? { animationDelay: `${(-performance.now()%dur)/1000}s` } : {});
	}, [dur, flag]);
	return ret;
}

function TeamProblem(
	{ sub: p2, focused, doSetFocusEl, setFocusEl, fx }: {
		sub: ScoreboardLastSubmission | null;
		focused: boolean;
		doSetFocusEl: boolean;
		setFocusEl: Dispatch<StateUpdater<HTMLDivElement | null>>;
		fx: OverlayFx;
	},
) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (doSetFocusEl && el) {
			setFocusEl(el);
			return () => setFocusEl(f => f == el ? null : f);
		}
	}, [doSetFocusEl, setFocusEl]);

	const [p, setP] = useState<ScoreboardLastSubmission | null>(null);
	useEffect(() => {
		const tm = setTimeout(() => setP(p2), 500);
		return () => {
			setP(p2);
			clearTimeout(tm);
		};
	}, [p2]);

	const didAc = p?.ac == true;
	useEffect(() => {
		const d = ref.current;
		if (focused && didAc && d) {
			fx.track(d);
			return () => fx.untrack(d);
		}
	}, [didAc, focused, fx]);

	const changed = useChanged(500, p?.ac, p?.incorrect ?? 0) && p?.ac != null;

	return <div ref={ref}
		className={twJoin(
			"h-full w-full transition-colors duration-500",
			rowBorder,
			focused && "border-2 border-sky-300",
			changed
				? (p?.ac == true ? "bg-green-200 text-black" : "bg-rose-200 text-black")
				: p != null && p.ac == null
				? twJoin(highlightBg, "text-black")
				: p?.ac == true
				? p?.first ? "bg-green-500/90" : "bg-green-500/65"
				: (p != null && p.incorrect > 0 ? "bg-red-500/65" : null),
		)}>
		{p != null
			&& <div className="flex flex-col gap-0.5 items-center h-full justify-center p-0.5 text-[0.7rem] relative">
				{p.ac == null
					&& <div className="left-0 top-0 bottom-0 right-0 bg-amber-100 animate-pulse-faster" />}
				<div className="flex items-center gap-2">
					{p.ac == null
						? <ThemeSpinner size={32} />
						: <span className={twJoin("transition-transform", changed && "scale-200 duration-500")}>
							{p.ac == true ? <IconCheck size={32} stroke={3} /> : <IconX size={32} stroke={3} />}
						</span>}
					{p.first && <Text v="md" className="text-sm">#1</Text>}
				</div>
				{p.incorrect != null && p.incorrect > 0 && <span>{p.incorrect} incorrect</span>}
				{p.ac == true && p.penaltyMinutes != null && <span>{p.penaltyMinutes} minutes</span>}
			</div>}
	</div>;
}

const rowBg = (i: number) => i%2 == 0 ? "bg-black/5" : "bg-white/5";

const rowFocus = (focus: FocusEvent | null | undefined, id: number, side?: "l" | "r") => {
	const f = focus != undefined && focus.team == id;
	return twJoin(
		focus != undefined && !f && "opacity-50",
		f && "border-t-2 border-b-2 theme:border-blue-400/40",
		f && side == "l" && "border-l-2",
		f && side == "r" && "border-r-2",
	);
};

const leftRowCls = (
	i: number,
	focus: FocusEvent | null | undefined,
	id: number,
	side?: "l" | "r",
) =>
	twJoin(
		"flex flex-row h-20 items-center gap-4 overflow-hidden shrink-0 pr-0 absolute w-full transition-all duration-500",
		rowBg(i),
		rowBorder,
		rowFocus(focus, id, side),
	);

function LeftCol(
	{ vert, children, title, titleClassName, className, sm }: {
		vert: ScrollData;
		children?: ComponentChildren;
		title?: ComponentChildren;
		titleClassName?: string;
		className?: string;
		sm?: boolean;
	},
) {
	return <div className={twMerge("flex flex-col bg-black/40", className)}>
		<Text v={sm == true ? "smbold" : "md"}
			className={twJoin("h-27 flex items-end pb-3 shrink-0", titleClassName, rowBorder)}>
			{title}
		</Text>
		<Scroller data={vert}>
			<div className="relative">{children}</div>
		</Scroller>
	</div>;
}

function ProblemHeader(
	{ stats, prob, name }: {
		name: string;
		prob: string;
		stats: { wa: number; pend: boolean; ac: number } | null;
	},
) {
	const pendDelay = useAnimDelay(1500, stats?.pend == true);
	return <div
		className={twJoin(
			"flex flex-col gap-1 justify-start pt-3 relative items-center pb-4 h-27 shrink-0 transition-colors duration-500",
			rowBorder,
			useChanged(500, stats?.wa, stats?.ac) ? highlightBg : "bg-black/40",
		)}>
		<Text v="big">{prob}</Text>
		<Text v="sm" className="text-[0.6rem] text-center">{name}</Text>
		{stats != null
			&& <div style={pendDelay}
				className={twJoin(
					"flex flex-row gap-1 bottom-1 absolute",
					stats?.pend == true && "animate-pulse-faster",
				)}>
				<Text v="sm" className="text-[0.6rem] theme:text-green-400">{stats.ac} AC</Text>
				<Divider vert className="h-3" />
				<Text v="sm" className="text-[0.6rem] theme:text-red-500">{stats.wa} WA</Text>
			</div>}
	</div>;
}

type SolveEvent = Readonly<{ problem: string; team: number; sub: ScoreboardLastSubmission }>;

type FocusEvent = Readonly<
	{ problem: string | null; team: number; sub: ScoreboardLastSubmission | null }
>;

function HighlightChangeRow(
	{ txt, i, id, focus }: {
		txt: string | number;
		i: number;
		id: number;
		focus?: FocusEvent | null;
		className?: string;
	},
) {
	const c = useChanged(500, txt);
	return <div
		className={twMerge(
			leftRowCls(i, focus, id),
			"font-big text-lg font-bold text-center justify-center pr-1 pl-1",
			c && highlightBg,
		)}
		data-id={id}>
		{txt}
	</div>;
}

export function ScoreboardStatus(
	{ sc, home, pend }: { sc?: Scoreboard; home?: boolean; pend?: number },
) {
	const untilStart = useTimeUntil(sc?.startTimeMs ?? null);
	const untilEnd = useTimeUntil(sc?.endTimeMs ?? null);
	const untilFreeze = useTimeUntil(sc?.freezeTimeMs ?? null);

	const tag = (time: number | null, txt: string) =>
		<div className="flex flex-row gap-2 items-center">
			{home == true
				? <>
					<Countdown time={time} />
					<Text v="bold" className="mb-2 ml-4">{txt}</Text>
				</>
				: <Text v="bold">
					<span className="font-big font-black">
						<Countdown inline time={time} />
					</span>{" "}
					<span className="text-white/90">{txt}</span>
				</Text>}
		</div>;

	return <>
		{pend != null && <Text>
			{pend == 0 ? "All submissions judged." : <>
				<span className="font-black font-big">{pend}</span> pending submissions
			</>}
		</Text>}

		{untilStart != null && untilStart > 0
			? tag(untilStart, "until start")
			: untilFreeze != null && untilFreeze > 0
			? tag(untilFreeze, "until freeze")
			: untilEnd != null && untilEnd > 0
			? tag(
				untilEnd,
				`until end${untilFreeze != null && untilFreeze < 0 ? " (standings frozen)" : ""}`,
			)
			: tag(
				null,
				sc?.resolvingState.type == "resolving" && home != true
					? "Resolver"
					: `Contest is over, standings ${
						sc?.resolvingState.type == "resolved" ? "resolved" : "frozen"
					}.`,
			)}

		{home == true && (untilStart != null && untilStart < 0
			? <Button
				onClick={() => window.open(import.meta.env["VITE_CONTEST_URL"] as string, "_blank")}>
				View scoreboard
			</Button>
			: <div />)}
	</>;
}

type OverlayFx = ReturnType<typeof useOverlayEffect>;

function SolveAnnouncement(
	{ scoreboard, curSolve, fx }: {
		scoreboard: Scoreboard;
		curSolve: SolveEvent | null;
		fx: OverlayFx;
	},
) {
	const [solve, setSolve] = useState<SolveEvent | null>(null);
	const r = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (curSolve) setSolve(curSolve);
	}, [curSolve]);
	useEffect(() => {
		const el = r.current;
		if (!el) return;
		if (curSolve != null && curSolve.sub.ac == true) {
			fx.active()?.add(el);
			const tm = setTimeout(() => fx.active()?.delete(el), 1500);
			return () => {
				clearTimeout(tm);
				fx.active()?.delete(el);
			};
		}
	}, [curSolve, fx]);
	const newSolve = useChanged(100, solve);
	if (!solve) return <></>;
	const team = scoreboard.teams.get(solve.team);
	const name = scoreboard.problemNames.get(solve.problem);
	if (!team || name == null) return <></>;
	const min = Math.floor((solve.sub.submissionTimeMs-scoreboard.startTimeMs!)/(60*1000));
	const probI = solve != null
		? [...scoreboard.problemNames.keys()].sort().indexOf(solve.problem)
		: 0;
	return <div
		className="flex justify-center gap-4 items-center h-fit my-auto p-3 relative w-fit mx-auto"
		ref={r}>
		<div
			className={twJoin(
				"bg-white left-0 top-0 right-0 bottom-0 absolute z-10 ease-in",
				!newSolve && "animate-shrink-x",
			)} />

		<div className="absolute -z-10 left-0 top-0 right-0 bottom-0 animate-fade-in bg-black/30 blur-2xl" />

		{team.logo != null
			&& <img className="h-2/3 animate-fade-in" src={new URL(team.logo, apiBaseUrl).href} />}
		<Text v="md" className={twJoin(!newSolve && "animate-shrink ease-in text-2xl")}>
			<span className="text-sky-300">{team.name}</span> {solve.sub.ac == false
				? <>
					got <span className="text-red-500">{solve.sub.verdict}</span> on
				</>
				: "solved"}{" "}
			<span className={chipTextColors[chipColorKeys[probI%chipColorKeys.length]]}>
				{solve.problem}. {name}
			</span>{" "}
			at <span className="text-orange-400">{min}</span> minutes{solve.sub.ac == true ? "!" : "."}
		</Text>
	</div>;
}

function useOverlayEffect() {
	const squareSide = 100;
	const state = useRef<
		{
			active: Set<HTMLElement>;
			squares: Map<string, { i: number; j: number; el: HTMLElement }>;
			track: Map<HTMLElement, { els: HTMLElement[]; start: number }>;
			fading: Set<HTMLElement>;
		}
	>(null);

	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		state.current = { active: new Set(), squares: new Map(), fading: new Set(), track: new Map() };
		const s = state.current;
		const root = ref.current;
		if (root == null) return;

		let frame: number | null = null;
		let x = 0, y = 0, lt = performance.now();
		const minMs = Math.ceil(1000/30);

		const cb = (t: number) => {
			if (t < lt+minMs) {
				frame = requestAnimationFrame(cb);
				return;
			}

			const dt = (t-lt)*0.005, r = t/5000;
			lt = t;

			x += Math.cos(0.2*r)*dt*squareSide;
			y += Math.sin(0.1*r)*dt*squareSide;
			const b = { left: x, right: x, top: y, bottom: y };

			const marked = new Set<string>();

			const addSq = (i: number, j: number) => {
				const sq = document.createElement("div");
				root.appendChild(sq);
				s.squares.set(`${i}-${j}`, { i, j, el: sq });
				sq.style.position = "absolute";
				sq.style.background = "white";
				sq.style.width = sq.style.height = px(squareSide*0.8);
				const v = [{ opacity: 0, transform: "scale(1)" }, {
					opacity: Math.random()*Math.random(),
					transform: `scale(${1+Math.random()})`,
				}];
				if (Math.random() < 0.5) v.reverse();
				sq.animate(v, { duration: Math.random()+200+1000, easing: "ease-out", fill: "forwards" });
			};

			let limit = 100-s.fading.size;
			for (const elem of s.active) {
				const orect = elem.getBoundingClientRect();
				const nrect = { left: 0, right: 0, bottom: 0, top: 0 };
				for (const k of ["right", "bottom", "left", "top"] as const) {
					nrect[k] = Math.floor((orect[k]-b[k])/squareSide);
				}
				for (let i = nrect.top; i <= nrect.bottom && limit > 0; i += 5) {
					for (let j = nrect.left; j <= nrect.right; j += 5) {
						const k = `${i}-${j}`;
						marked.add(k);
						if (!s.squares.has(k)) addSq(i, j);
						if (--limit <= 0) break;
					}
				}
			}

			for (const [k, { i, j, el }] of s.squares) {
				el.style.top = px((i+0.1)*squareSide+y);
				el.style.left = px((j+0.1)*squareSide+x);
				if (!marked.has(k)) {
					const a = el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], {
						fill: "forwards",
						easing: "ease-out",
						duration: 1000,
					});
					a.oncancel = a.onfinish = () => {
						el.remove();
						s.fading.delete(el);
					};
					s.squares.delete(k);
					s.fading.add(el);
				}
			}

			const numTrackEls = 5, numStep = 10, dur = 500;
			for (const [k, v] of s.track) {
				if (v.els.length == 0) {
					v.els = fill(numTrackEls, () => {
						const d = document.createElement("div");
						root.appendChild(d);
						d.style.position = "absolute";
						d.style.background = "#23542773";
						d.style.border = "1px solid #4dff7cc2";
						return d;
					});
				}

				const step = Math.floor((t-v.start)/dur*numStep);
				if (step > numStep || !document.body.contains(k)) {
					v.els.forEach(x => x.remove());
					s.track.delete(k);
					continue;
				}

				const r = k.getBoundingClientRect();
				const a = (r.height+r.width)/2;
				const r2 = { top: r.top, left: r.left, width: a, height: a };
				for (let i = 0; i < v.els.length; i++) {
					for (const k of ["top", "width", "left", "height"] as const) {
						v.els[i].style[k] = px(r2[k]);
					}
					v.els[i].style.transform = `scale(${
						(120+(400-390*step/numStep)*(i+1)/v.els.length)/100
					}) rotateZ(${(120+(400-390*step/numStep)*(i+1)/v.els.length)/4}deg)`;
				}
			}

			frame = requestAnimationFrame(cb);
		};

		frame = requestAnimationFrame(cb);
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			[
				...s.squares.values().map(({ el }) => el),
				...s.fading.values(),
				...s.track.values().flatMap(v => v.els),
			].forEach(v => v.remove());
		};
	}, []);

	return useMemo(() => ({
		active: () => state.current?.active,
		track(x: HTMLElement) {
			state.current?.track.set(x, { els: [], start: performance.now() });
		},
		untrack(x: HTMLElement) {
			state.current?.track.get(x)?.els.forEach(y => y.remove());
			state.current?.track.delete(x);
		},
		ref,
	}), []);
}

function TeamRank({ rank, resolved }: { rank: number; resolved?: boolean }) {
	const change = useChanged(500, rank);
	const animDelay = useAnimDelay(1500, resolved == false);
	return <Text v="bold" style={animDelay}
		className={twJoin(
			change && "theme:text-amber-300 scale-125",
			"transition-all duration-500",
			resolved == false && "animate-pulse-faster",
		)}>
		{"#"}
		{rank}
	</Text>;
}

function ScoreboardInner(
	{ scoreboard, sorted, currentSolve, focus, allowScroll, pending }: {
		scoreboard: Scoreboard;
		sorted: [number, ScoreboardTeam][];
		currentSolve: SolveEvent | null;
		pending: number;
		focus: FocusEvent | null;
		allowScroll?: boolean;
	},
) {
	const resState = scoreboard.resolvingState;
	const firstResolved = resState.type == "resolving"
		? sorted.findIndex(a => a[0] == resState.lastResolvedTeam)
		: -1;

	const [focusEl, setFocusEl] = useState<HTMLDivElement | null>(null);

	const probStats = useMemo(() => {
		const stats = new Map<string, { ac: number; pend: boolean; wa: number }>();
		for (const v of scoreboard.teams.values()) {
			for (const [p, pv] of v.problems) {
				const count = stats.get(p) ?? { ac: 0, pend: false, wa: 0 };
				if (pv.ac == true) count.ac++;
				else if (pv.incorrect > 0) count.wa++;
				if (pv.ac == null) count.pend = true;
				stats.set(p, count);
			}
		}
		return stats;
	}, [scoreboard.teams]);

	const oldYs = useRef<Map<number, number>>(new Map());
	const anims = useRef<Map<number, Animation[]>>(new Map());
	useEffect(() => {
		const u = anims.current;
		return () => {
			u.values().forEach(v => v.forEach(a => a.cancel()));
		};
	}, []);

	const ys = useMemo(() => new Map(sorted.map((v, i) => [v[0], i*20])), [sorted]);
	const toSpacing = (v: number) => `calc(var(--spacing) * ${v})`;
	const placeholder = <div className="w-full" style={{ height: toSpacing(20*sorted.length) }} />;

	const fx = useOverlayEffect();

	const [improved, setImproved] = useState<[number, HTMLElement[]][]>([]);
	const addedCurrentSolve = useRef<SolveEvent>(null);
	const firstImproved = improved[0] ?? null;
	useEffect(() => {
		if (firstImproved != null) {
			const tm = setTimeout(() => {
				firstImproved[1].forEach(v => fx.active()!.delete(v));
				setImproved(imp => imp.slice(1));
			}, firstImproved[0]-Date.now());
			return () => clearTimeout(tm);
		}
	}, [firstImproved, fx]);

	useEffect(() => {
		const m = anims.current;
		return () => {
			m.values().forEach(vs => vs.forEach(v => v.cancel()));
		};
	}, []);

	useEffect(() => {
		const animDuration = 1000;
		for (const [k, v] of ys.entries()) {
			const old = oldYs.current.get(k);
			const elems = [...document.querySelectorAll(`[data-id="${k}"]`)] as HTMLElement[];
			const anim = anims.current.get(k);
			if (old == undefined) {
				anim?.forEach(a => a.cancel());
				elems.forEach(e => {
					(e as HTMLDivElement).style.top = toSpacing(v);
				});
			} else if (v != old) {
				const newAnims = [];
				for (const el of elems) {
					newAnims.push(
						el.animate([{ top: getComputedStyle(elems[0]).top }, { top: toSpacing(v) }], {
							duration: animDuration,
							easing: "ease-in-out",
							fill: "forwards",
						}),
					);
				}

				anim?.forEach(a => a.cancel());
				anims.current.set(k, newAnims);
			}

			const addedSolve = addedCurrentSolve.current != currentSolve && currentSolve?.team == k
				&& currentSolve.sub.ac == true;
			if ((old != undefined && v < old) || addedSolve) {
				if (addedSolve) addedCurrentSolve.current = currentSolve;
				setImproved(old => [...old, [Date.now()+1000, elems]]);
				elems.forEach(x => fx.active()?.add(x));
			}

			oldYs.current.set(k, v);
		}
	}, [currentSolve, fx, scoreboard.teams, ys]);

	const problems = [...scoreboard.problemNames.keys()].sort();
	const vertFocusProb = problems.length > 0 ? problems[0] : null;

	const namesHoriz = useScroll({ dir: "horiz" });
	const horiz = useScroll({
		el: focus?.problem != null ? focusEl : null,
		dir: "horiz",
		syncScroll: allowScroll,
	});
	const vert = useScroll({
		duration: focusEl != null ? 1000 : Math.min(20_000, 300*sorted.length),
		delay: 10_000,
		delayBack: 0,
		el: focusEl,
		dir: "vert",
		syncScroll: allowScroll,
	});
	const translateStyle = { transform: `translateY(-${currentSolve != null ? 100 : 0}%)` };

	return <div className="w-[90%] flex flex-col items-center align-middle max-h-dvh overflow-hidden">
		<div className="-z-20 fixed overflow-hidden top-0 bottom-0 left-0 right-0" ref={fx.ref} />
		<div className="bg-black/40 w-full h-35 shrink-0 place-content-center flex flex-col justify-start overflow-hidden">
			<div className="h-full w-full shrink-0 transition-transform duration-1000 py-5 pb-1"
				style={translateStyle}>
				<h1 className="text-5xl flex flex-row">
					<span>HAMMERWARS</span>
					<span className="font-black">2025</span>
					<span className="inline-block w-[100px] shrink-0" />
					<span className="ml-auto">SCOREBOARD</span>
				</h1>

				<div className="flex flex-row justify-between pt-4">
					<ScoreboardStatus sc={scoreboard} pend={pending} />
				</div>
			</div>
			<div className="h-full shrink-0 flex transition-transform duration-1000"
				style={translateStyle}>
				<SolveAnnouncement scoreboard={scoreboard} curSolve={currentSolve} fx={fx} />
			</div>
		</div>

		<div className="flex flex-row grow overflow-hidden w-full">
			<div className="flex flex-row">
				<LeftCol vert={vert} title="Team" className="min-w-70" titleClassName="pr-0">
					{sorted.map(([id, team], i) =>
						<div className={twJoin(leftRowCls(i, focus, id, "l"), "pl-2 pr-0")} key={id}
							data-id={id}>
							<TeamRank rank={team.rank} resolved={i >= firstResolved} />
							{team.logo != null
								&& <img className="h-15 -mr-1" src={new URL(team.logo, apiBaseUrl).href} />}
							<Scroller data={namesHoriz} off={i/Math.max(1, sorted.length-1)}
								className="whitespace-nowrap h-full flex items-center">
								{team.name}
							</Scroller>
						</div>
					)}
					{placeholder}
				</LeftCol>

				<LeftCol vert={vert} title="Solves" sm titleClassName="pr-0 -ml-2 pr-1">
					{sorted.map(([id, team], i) =>
						<HighlightChangeRow txt={team.solves} i={i} key={id} id={id} focus={focus} />
					)}
					{placeholder}
				</LeftCol>

				<LeftCol vert={vert} title="Penalty" sm titleClassName="px-1">
					{sorted.map(([id, team], i) =>
						<HighlightChangeRow txt={team.penaltyMinutes} i={i} key={id} id={id} focus={focus} />
					)}
					{placeholder}
				</LeftCol>
			</div>

			<Scroller className="grow flex flex-row" off={1} data={horiz}>
				{problems.map((prob, i) => {
					const side = i == problems.length-1 ? "r" : undefined;
					const name = scoreboard.problemNames.get(prob)!;
					const stats = probStats.get(prob);
					return <div key={prob} className="overflow-hidden flex flex-col min-w-27">
						<ProblemHeader name={name} stats={stats ?? null} prob={prob} />
						<Scroller data={vert}>
							<div className="relative">
								{sorted.map(([id, team], i) => {
									const sub = team.problems.get(prob);

									return <div key={id}
										className={twJoin(
											"h-20 shrink-0 absolute transition-all duration-500 w-full",
											rowBg(i),
											rowFocus(focus, id, side),
										)} data-id={id}>
										<TeamProblem key={prob} sub={sub ?? null}
											doSetFocusEl={focus != undefined && focus.team == id
												&& ((focus.problem ?? vertFocusProb) == prob)}
											focused={focus != undefined && focus.team == id && focus.problem == prob}
											setFocusEl={setFocusEl} fx={fx} />
									</div>;
								})}
								{placeholder}
							</div>
						</Scroller>
					</div>;
				})}
			</Scroller>
		</div>

		<PatternBg velocity={0} pat={() => new Pattern2()} opacity={0.6} />
	</div>;
}

function ResolverShortcuts(
	{ scoreboard, sorted, focus }: {
		scoreboard: Scoreboard;
		focus: FocusEvent | null;
		sorted: [number, ScoreboardTeam][];
	},
) {
	const [apiKey, setApiKey] = useState("");
	const [apiKey2, setApiKey2] = useState<string | null>(() => apiKeyClient.auth.apiKey);
	const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
	const [viewTeamDetails, setViewTeamDetails] = useState(false);

	useShortcuts({ shortcut: "e", onClick: useCallback(() => setApiKeyModalOpen(true), []) });

	const curSkip = useMemo(
		() =>
			scoreboard.resolvingState.type == "resolving" && scoreboard.resolvingState.problem != null
				? { prob: scoreboard.resolvingState.problem, team: scoreboard.resolvingState.team }
				: null,
		[scoreboard.resolvingState],
	);
	const index = scoreboard.resolvingState.type == "unresolved"
		? 0
		: scoreboard.resolvingState.index;

	const mod = useAsync(useCallback(async (props: Partial<ContestProperties>) => {
		if (apiKey2 == null) throw new Error("Not logged in.");
		await apiKeyClient.request("setProperties", props);
	}, [apiKey2]));

	const modResIndex = useCallback(
		(idx: ContestProperties["resolveIndex"]) => mod.run({ resolveIndex: idx }),
		[mod],
	);

	const setFocus = useCallback((id: number | null) => mod.run({ focusTeamId: id }), [mod]);
	const [prv, nxt] = useMemo(() => {
		const idx = focus ? sorted.findIndex(v => v[0] == focus.team) : -1;
		if (idx != -1) return [sorted[idx-1]?.[0], sorted[idx+1]?.[0]];
		return [undefined, undefined];
	}, [focus, sorted]);

	useShortcuts({
		shortcut: "r",
		onClick: useCallback(() => {
			setViewTeamDetails(a => !a);
		}, []),
	});

	useShortcuts({
		shortcut: "1",
		onClick: useCallback(() => {
			if (prv != undefined) setFocus(prv);
		}, [prv, setFocus]),
	});

	useShortcuts({
		shortcut: "2",
		onClick: useCallback(() => {
			if (nxt != undefined) setFocus(nxt);
		}, [nxt, setFocus]),
	});

	useShortcuts({
		shortcut: "3",
		onClick: useCallback(() => {
			setFocus(null);
		}, [setFocus]),
	});

	useShortcuts({
		shortcut: "arrowright",
		onClick: useCallback(() => {
			modResIndex({ type: "index", index: index+1 });
		}, [index, modResIndex]),
	});

	useShortcuts({
		shortcut: "arrowleft",
		onClick: useCallback(() => {
			modResIndex({ type: "index", index: index-1 });
		}, [index, modResIndex]),
	});

	useShortcuts({
		shortcut: "arrowdown",
		onClick: useCallback(() => {
			if (curSkip) {
				modResIndex({ type: "problem", forward: false, ...curSkip });
			}
		}, [curSkip, modResIndex]),
	});

	useShortcuts({
		shortcut: "arrowup",
		onClick: useCallback(() => {
			if (curSkip) {
				modResIndex({ type: "problem", forward: true, ...curSkip });
			}
		}, [curSkip, modResIndex]),
	});

	const team = focus ? scoreboard.teams.get(focus.team) : null;
	return <>
		{viewTeamDetails
			&& <div className="flex flex-col gap-2 fixed top-0 left-0 bg-black/70 p-4 z-10">
				{team && focus
					? <>
						<Text v="md">{team.name}</Text>
						<Text>Members: {team.members.join(", ")}</Text>
						<Text v="sm">Id: {focus.team}</Text>
					</>
					: <Text>No team selected</Text>}
			</div>}

		<Modal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)}>
			<form className="flex flex-col gap-1 items-stretch" onSubmit={ev => {
				ev.preventDefault();
				if (ev.currentTarget.reportValidity()) {
					LocalStorage.apiKey = apiKey;
					setApiKeyModalOpen(false);
					setApiKey2(apiKey);
				}
			}}>
				Enter API Key
				<Input value={apiKey} onInput={ev => setApiKey(ev.currentTarget.value)} required />
				<Button>Login</Button>
			</form>
		</Modal>
	</>;
}

export default function ScoreboardPage() {
	const [actualScoreboard, setActualScoreboard] = useState<Scoreboard | null>(null);
	const [events, setEvents] = useState<{ solve: SolveEvent; newScoreboard: Scoreboard }[]>([]);
	const [judging, setJudging] = useState<SolveEvent[]>([]);

	const firstEv = events.length > 0 ? events[0] : null;
	useEffect(() => {
		if (!firstEv) return;
		const tm = setTimeout(() => setEvents(evs => evs.slice(1)), 2000);
		return () => clearTimeout(tm);
	}, [firstEv]);
	const scoreboard = firstEv?.newScoreboard ?? actualScoreboard;

	const updateThrottle = useDisposable(() => throttle(100), []);

	const setScoreboard = useCallback((nsc: Scoreboard) => {
		updateThrottle!.call(() =>
			setActualScoreboard(oldSc => {
				const newJudging: SolveEvent[] = [];
				const nevs: typeof events = [];
				for (const [k, v] of nsc.teams) {
					const oldTeam = oldSc?.teams.get(k);
					for (const [k2, v2] of v.problems) {
						const nev: SolveEvent = { team: k, problem: k2, sub: v2 };
						if (v2.ac == null) newJudging.push(nev);
						else if (
							oldTeam?.problems?.get(k2)?.ac != true && v2.ac == true
							&& v2.submissionTimeMs >= Date.now()-10_000 && oldSc != null
						) {
							// if there's more than 1 solve in this update it won't look very nice but that's fine..
							nevs.push({ solve: nev, newScoreboard: nsc });
						}
					}
				}

				if (nsc.resolvingState.type == "unresolved") {
					setEvents(evs => [...evs, ...nevs]);
				} else {
					// fuck that, server was probably restarted 🤡
					// just fast forward
					setEvents([]);
				}

				setJudging(newJudging);
				return nsc;
			})
		);
	}, [updateThrottle]);

	useFeed("scoreboard", setScoreboard);

	const [toggleControl, setToggleControl] = useState(false);
	useShortcuts({ shortcut: "d", onClick: useCallback(() => setToggleControl(a => !a), []) });

	const resolving = actualScoreboard?.resolvingState.type == "resolving"
		? actualScoreboard.resolvingState
		: null;
	const resolvingSolve = useMemo(
		() =>
			resolving?.sub != null && resolving.problem != null
				? { problem: resolving.problem, sub: resolving.sub, team: resolving.team }
				: null,
		[resolving],
	);

	const focus = useMemo(
		() =>
			toggleControl
				? null
				: scoreboard?.focusTeamId != null
				? { team: scoreboard.focusTeamId, problem: null, sub: null }
				: resolving ?? firstEv?.solve ?? judging[0] ?? null,
		[firstEv?.solve, judging, resolving, scoreboard?.focusTeamId, toggleControl],
	);

	const sorted = useMemo(() => [...scoreboard?.teams.entries() ?? []].toSorted(cmpTeamRankId), [
		scoreboard?.teams,
	]);

	if (scoreboard == null) return <Loading />;

	return <>
		<ResolverShortcuts scoreboard={scoreboard} sorted={sorted} focus={focus} />
		<ScoreboardInner scoreboard={scoreboard} sorted={sorted} pending={judging.length}
			currentSolve={toggleControl || scoreboard.focusTeamId != null
				? null
				: resolvingSolve ?? firstEv?.solve ?? null} focus={focus} allowScroll={toggleControl} />
	</>;
}
