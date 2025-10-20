import { IconCheck, IconX } from "@tabler/icons-preact";
import { ComponentChildren, createContext, Fragment, RefObject } from "preact";
import { Dispatch, StateUpdater, useCallback, useContext, useEffect, useMemo, useRef,
	useState } from "preact/hooks";
import { twJoin, twMerge } from "tailwind-merge";
import { APIClient, fill, mapWith, parseExtra, Scoreboard, ScoreboardLastSubmission, ScoreboardTeam,
	stringifyExtra } from "../../shared/util";
import { apiBaseUrl, apiClient, useFeed } from "./clientutil";
import { Pattern2, PatternBg } from "./home";
import replay from "./icpc2019_replay.ndjson?raw";
import { borderColor, Button, Collapse, Countdown, Divider, ease, Loading, outlineColor, px, Text,
	ThemeSpinner, useAsync, useTimeUntil } from "./ui";

type ScrollData = {
	duration: number;
	delay: number;
	direction: "forward" | "reverse";
	target: { dir: "vert" | "horiz"; offsets: HTMLElement[]; subOffset: HTMLElement } | null;
	scrollersRef: RefObject<Map<HTMLElement, "vert" | "horiz">>;
};

function useScroll(
	{ duration, delay, delayBack, el }: {
		duration?: number;
		delay?: number;
		delayBack?: number;
		el?: HTMLElement | null;
	} = {},
): ScrollData {
	const [dir, setDir] = useState<"forward" | "reverse">("reverse");
	const [target, setTarget] = useState<ScrollData["target"]>(null);
	const scrollersRef = useRef(new Map<HTMLElement, "vert" | "horiz">());
	const scrollDuration = duration ?? 1000,
		scrollDelay = (dir == "forward" ? (delayBack ?? delay) : delay) ?? 3000;

	useEffect(() => {
		let el2: HTMLElement | null | undefined = el;
		if (el2 != null) {
			let p: HTMLElement | null = null;
			const offsetEls: HTMLElement[] = [];
			while (el2 != null && !scrollersRef.current.has(el2)) {
				if (el2.offsetParent != p) {
					offsetEls.push(el2);
					p = el2.offsetParent as HTMLElement | null;
				}
				el2 = el2.parentElement;
			}
			if (el2 != null) {
				const scroller = scrollersRef.current.get(el2)!;
				setTarget({ dir: scroller, offsets: offsetEls, subOffset: el2 });
			}
		}
		if (el2 == null) setTarget(null);

		const tm = setTimeout(() => {
			setDir(dir == "forward" ? "reverse" : "forward");
		}, scrollDelay+scrollDuration);
		return () => clearTimeout(tm);
	}, [dir, scrollDelay, scrollDuration, el]);

	return { direction: dir, duration: scrollDuration, delay: scrollDelay, target, scrollersRef };
}

function Scroller(
	{
		children,
		className,
		off,
		vert,
		data: { duration, delay, direction, target: dataTarget, scrollersRef },
	}: {
		children?: ComponentChildren;
		className?: string;
		vert?: boolean;
		off?: number;
		data: ScrollData;
	},
) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const s = scrollersRef.current, d = ref.current!;
		s.set(d, vert == true ? "vert" : "horiz");
		return () => s.delete(d);
	}, [scrollersRef, vert]);

	useEffect(() => {
		const d = ref.current;
		if (!d) return;
		let frame: number | null = null;
		const cb = () => {
			const sz = vert == true ? d.clientHeight : d.clientWidth;
			const inner = vert == true ? d.scrollHeight : d.scrollWidth;
			if (frame != null) cancelAnimationFrame(frame);
			if (inner <= sz) {
				d.style.maskImage = "";
				return;
			}
			const prop = vert == true ? "scrollTop" : "scrollLeft";
			const animMask = () => {
				const a = 5*d[prop]/(inner-sz);
				d.style.maskImage = `linear-gradient(to ${
					vert == true ? "bottom" : "right"
				}, transparent 0%, black ${a}%, black ${100-(5-a)}%, transparent 100%)`;
			};

			const follow = dataTarget != null && (vert == true ? "vert" : "horiz") == dataTarget.dir
				? dataTarget
				: null;
			const start = performance.now()+(follow ? 0 : delay*(off ?? 0));
			const init = d[prop];
			let target = direction == "forward" ? inner-sz : 0;

			const cb2 = (t: number) => {
				if (follow != null) {
					let offset = 0;
					const prop = vert == true ? "offsetTop" : "offsetLeft";
					for (const el of follow.offsets) offset += el[prop];
					offset -= follow.subOffset[prop];
					target = Math.max(Math.min(inner-sz, offset-sz/2), 0);
				}

				const dt = Math.max(0, (t-start)/duration);
				if (dt >= 1) {
					d[prop] = target;
					animMask();
					if (follow == null) return;
				}

				const e = ease(dt);
				d[prop] = e*target+init*(1-e);
				animMask();
				frame = requestAnimationFrame(cb2);
			};
			frame = requestAnimationFrame(cb2);
		};
		cb();
		const obs = new ResizeObserver(cb);
		obs.observe(d);
		return () => {
			obs.disconnect();
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, [dataTarget, delay, direction, duration, off, vert]);

	return <div className={twMerge("overflow-hidden", className)} data-scroll ref={ref}>
		{children}
	</div>;
}

const rowBorder = "border-b-2 box-border border-neutral-800";
const highlightBg = "theme:bg-amber-400/90 theme:text-black";

function useChanged(...values: unknown[]) {
	const [ret, setRet] = useState<boolean>(false);
	const init = useRef(false);
	useEffect(() => {
		if (!init.current) {
			init.current = true;
			return;
		}
		setRet(true);
		const tm = setTimeout(() => setRet(false), 500);
		return () => clearTimeout(tm);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, values);
	return ret;
}

function TeamProblem(
	{ sub: p2, focused, setFocusEl, fx }: {
		sub: ScoreboardLastSubmission | null;
		focused: boolean;
		setFocusEl: Dispatch<StateUpdater<HTMLDivElement | null>>;
		fx: OverlayFx;
	},
) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (focused && el) {
			setFocusEl(el);
			return () => setFocusEl(f => f == el ? null : f);
		}
	}, [focused, setFocusEl]);

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
		if (didAc && d) {
			fx.track(d);
			return () => fx.untrack(d);
		}
	}, [didAc, fx]);

	return <div ref={ref}
		className={twJoin(
			"h-full w-full transition-colors duration-500",
			rowBorder,
			focused && "border-2 border-sky-300",
			useChanged(p?.ac, p?.incorrect ?? 0) && p?.ac != null
				? (p?.ac == true ? "bg-green-200 text-black" : "bg-rose-200 text-black")
				: p != null && p.ac == null
				? twJoin(highlightBg, "text-black")
				: p?.ac == true
				? p?.first ? "bg-green-500/70" : "bg-green-500/50"
				: (p != null && p.incorrect > 0 ? "bg-red-500/50" : null),
		)}>
		{p != null
			&& <div className="flex flex-col gap-0.5 items-center h-full justify-center p-0.5 text-[0.7rem] relative">
				{p.ac == null
					&& <div className="left-0 top-0 bottom-0 right-0 bg-amber-100 animate-pulse" />}
				<div className="flex items-center gap-2">
					{p.ac == null
						? <ThemeSpinner size={32} />
						: p.ac == true
						? <IconCheck size={32} stroke={3} />
						: <IconX size={32} stroke={3} />}
					{p.first && <Text v="md" className="text-sm">#1</Text>}
				</div>
				{p.incorrect != null && p.incorrect > 0 && <span>{p.incorrect} incorrect</span>}
				{p.ac == true && p.penaltyMinutes != null && <span>{p.penaltyMinutes} minutes</span>}
			</div>}
	</div>;
}

const rowBg = (i: number) => i%2 == 0 ? "bg-black/5" : "bg-white/5";

const rowFocus = (focus: SolveEvent | null | undefined, id: number) =>
	twJoin(
		focus != undefined
			&& (focus.teamId != id ? "opacity-50" : "border-t-2 border-b-2 theme:border-blue-400/40"),
	);

const leftRowCls = (i: number, focus: SolveEvent | null | undefined, id: number) =>
	twJoin(
		"flex flex-row h-20 items-center gap-4 overflow-hidden shrink-0 pr-0 absolute w-full transition-all duration-500",
		rowBg(i),
		rowBorder,
		rowFocus(focus, id),
	);

function LeftCol(
	{ vert, children, title, className, sm }: {
		vert: ScrollData;
		children?: ComponentChildren;
		title?: ComponentChildren;
		className?: string;
		sm?: boolean;
	},
) {
	return <div className={twMerge("flex flex-col bg-black/40 overflow-hidden", className)}>
		<Text v={sm == true ? "smbold" : "md"}
			className={twJoin("h-25 flex items-center shrink-0 pr-0 px-2", rowBorder)}>
			{title}
		</Text>
		<Scroller data={vert} vert>
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
	return <div
		className={twJoin(
			"flex flex-col gap-1 justify-start pt-1 relative items-center pb-4 h-25 shrink-0 transition-colors duration-500",
			rowBorder,
			useChanged(stats?.wa, stats?.ac) ? highlightBg : "bg-black/40",
		)}>
		<Text v="big">{prob}</Text>
		<Text v="sm" className="text-[0.6rem] text-center">{name}</Text>
		{stats != null
			&& <div
				className={twJoin("flex flex-row gap-1 bottom-1 absolute", stats.pend && "animate-pulse")}>
				<Text v="sm" className="text-[0.6rem] theme:text-green-400">{stats.ac} AC</Text>
				<Divider vert className="h-3" />
				<Text v="sm" className="text-[0.6rem] theme:text-red-500">{stats.wa} WA</Text>
			</div>}
	</div>;
}

type SolveEvent = { problem: string; teamId: number; sub: ScoreboardLastSubmission };

function HighlightChangeRow(
	{ txt, i, id, focus }: { txt: string | number; i: number; id: number; focus?: SolveEvent | null },
) {
	const c = useChanged(txt);
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

export function ScoreboardStatus({ sc, home }: { sc?: Scoreboard; home?: boolean }) {
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
		{home != true
			&& (untilFreeze != null && untilFreeze > 0 ? tag(untilFreeze, "until freeze") : <div />)}

		{untilStart != null && untilStart > 0
			? tag(untilStart, "until start")
			: untilEnd != null && untilEnd > 0
			? tag(
				untilEnd,
				`until end${untilFreeze != null && untilFreeze < 0 ? " (standings frozen)" : ""}`,
			)
			: tag(
				null,
				`Contest is over, standings ${sc?.resolvingState == "resolved" ? "resolved" : "frozen"}.`,
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
		if (curSolve != null && solve != null) {
			fx.active()?.add(el);
			const tm = setTimeout(() => fx.active()?.delete(el), 1500);
			return () => {
				clearTimeout(tm);
				fx.active()?.delete(el);
			};
		}
	}, [curSolve, fx, solve]);
	if (!solve) return <></>;
	const team = scoreboard.teams.get(solve.teamId);
	const name = scoreboard.problemNames.get(solve.problem);
	if (!team || name == null) return <></>;
	const min = Math.floor((solve.sub.submissionTimeMs-scoreboard.startTimeMs!)/(60*1000));
	return <div
		className="flex justify-center gap-4 items-center h-fit my-auto p-3 relative w-fit mx-auto"
		ref={r}>
		<div className="bg-white left-0 top-0 right-0 bottom-0 absolute z-10 animate-shrink ease-out"
			key={`${solve.teamId}-${solve.problem}`} />

		<div className="absolute -z-10 left-0 top-0 right-0 bottom-0 animate-fade-in bg-black/30 blur-2xl" />

		{team.logo != null && <img className="h-2/3" src={"/api/teamLogo/1"} />}
		<Text v="md">
			<span className="text-sky-300">{team.name}</span> solved{" "}
			<span className="text-amber-300">{solve.problem}. {name}</span> at{" "}
			<span className="text-red-400">{min}</span> minutes!
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

		const cb = (t: number) => {
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
					transform: "scale(1.5)",
				}];
				if (Math.random() < 0.5) v.reverse();
				sq.animate(v, { duration: Math.random()+200+1000, easing: "ease-out", fill: "forwards" });
			};

			for (const elem of s.active) {
				const orect = elem.getBoundingClientRect();
				const nrect = { left: 0, right: 0, bottom: 0, top: 0 };
				for (const k of ["right", "bottom", "left", "top"] as const) {
					nrect[k] = Math.floor((orect[k]-b[k])/squareSide);
				}
				for (let i = nrect.top; i <= nrect.bottom; i += 3) {
					for (let j = nrect.left; j <= nrect.right; j += 3) {
						const k = `${i}-${j}`;
						marked.add(k);
						if (!s.squares.has(k)) addSq(i, j);
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

function TeamRank({ rank }: { rank: number }) {
	const change = useChanged(rank);
	return <Text v="bold"
		className={twJoin(change && "theme:text-amber-300 scale-125", "transition-all duration-500")}>
		{"#"}
		{rank}
	</Text>;
}

function ScoreboardInner(
	{ scoreboard, currentSolve, focus }: {
		scoreboard: Scoreboard;
		currentSolve: SolveEvent | null;
		focus: SolveEvent | null;
	},
) {
	const sorted = useMemo(
		() =>
			[...scoreboard.teams.entries()].toSorted(([k1, a], [k2, b]) =>
				(a.rank < b.rank || (a.rank == b.rank && k1 < k2)) ? -1 : 1
			),
		[scoreboard.teams],
	);

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
	for (let i = 0; i < improved.length; i++) {
		if (improved.slice(i+1).some(v => v[1][0] == improved[i][1][0])) {
			console.error("aaa");
		}
	}
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
				anim?.forEach(a => a.pause());

				const newAnims = [];
				for (const el of elems) {
					newAnims.push(
						el.animate([{ top: getComputedStyle(elems[0]).top }, { top: toSpacing(v) }], {
							duration: animDuration,
							easing: "ease-out",
							fill: "forwards",
						}),
					);
				}
				anims.current.set(k, newAnims);
			}

			const addedSolve = addedCurrentSolve.current != currentSolve && currentSolve?.teamId == k;
			if ((old != undefined && v < old) || addedSolve) {
				if (addedSolve) addedCurrentSolve.current = currentSolve;
				console.log(k, scoreboard.teams.get(k)?.name);
				setImproved(old => [...old, [Date.now()+1000, elems]]);
				elems.forEach(x => fx.active()?.add(x));
			}

			oldYs.current.set(k, v);
		}
	}, [currentSolve, fx, ys]);

	const problems = [...scoreboard.problemNames.keys()].sort();

	const namesHoriz = useScroll();
	const horiz = useScroll({ el: focusEl });
	const vert = useScroll({
		duration: focusEl != null ? 1000 : 300*sorted.length,
		delay: 2000,
		delayBack: 0,
		el: focusEl,
	});
	const translateStyle = { transform: `translateY(-${currentSolve != null ? 100 : 0}%)` };

	return <div className="w-[90%] flex flex-col items-center align-middle max-h-dvh overflow-hidden">
		<div className="-z-20 fixed overflow-hidden top-0 bottom-0 left-0 right-0" ref={fx.ref} />
		<div className="bg-black/40 w-full h-35 shrink-0 place-content-center flex flex-col justify-start overflow-hidden">
			<div className="h-full w-full shrink-0 transition-transform duration-1000 py-5"
				style={translateStyle}>
				<h1 className="text-5xl flex flex-row">
					<span>HAMMERWARS</span>
					<span className="font-black">2025</span>
					<span className="inline-block w-[100px] shrink-0" />
					<span className="ml-auto">SCOREBOARD</span>
				</h1>

				<div className="flex flex-row justify-between pt-4">
					<ScoreboardStatus sc={scoreboard} />
				</div>
			</div>
			<div className="h-full pb-4 shrink-0 flex transition-transform duration-1000"
				style={translateStyle}>
				<SolveAnnouncement scoreboard={scoreboard} curSolve={currentSolve} fx={fx} />
			</div>
		</div>

		<div className="flex flex-row grow overflow-hidden w-full">
			<div className="flex flex-row">
				<LeftCol vert={vert} title="Team" className="min-w-70">
					{sorted.map(([id, team], i) =>
						<div className={twJoin(leftRowCls(i, focus, id), "pl-2 pr-0")} key={id} data-id={id}>
							<TeamRank rank={team.rank} />
							{team.logo != null && <img className="h-15 -mr-1" src={team.logo} />}
							<Scroller data={namesHoriz} off={i/Math.max(1, sorted.length-1)}
								className="whitespace-nowrap">
								{team.name}
							</Scroller>
						</div>
					)}
					{placeholder}
				</LeftCol>

				<LeftCol vert={vert} title="Solves" sm>
					{sorted.map(([id, team], i) =>
						<HighlightChangeRow txt={team.solves} i={i} key={id} id={id} focus={focus} />
					)}
					{placeholder}
				</LeftCol>

				<LeftCol vert={vert} title="Penalty" sm>
					{sorted.map(([id, team], i) =>
						<HighlightChangeRow txt={team.penaltyMinutes} i={i} key={id} id={id} focus={focus} />
					)}
					{placeholder}
				</LeftCol>
			</div>

			<Scroller className="grow flex flex-row" off={1} data={horiz}>
				{problems.map(prob => {
					const name = scoreboard.problemNames.get(prob)!;
					const stats = probStats.get(prob);
					return <div key={prob} className="overflow-hidden flex flex-col min-w-27">
						<ProblemHeader name={name} stats={stats ?? null} prob={prob} />
						<Scroller data={vert} vert>
							<div className="relative">
								{sorted.map(([id, team], i) => {
									const sub = team.problems.get(prob);

									return <div key={id}
										className={twJoin(
											"h-20 shrink-0 absolute transition-all duration-500 w-full",
											rowBg(i),
											rowFocus(focus, id),
										)} data-id={id}>
										<TeamProblem key={prob} sub={sub ?? null}
											focused={focus != undefined && focus.teamId == id && focus.problem == prob}
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

		<PatternBg velocity={0} pat={() => new Pattern2()} />
	</div>;
}

const replayParsed = replay.trim().split("\n").map(v => {
	let x = parseExtra(v) as Scoreboard;
	x = {
		...x,
		teams: new Map([
			...x.teams.entries(),
			...fill(10, i =>
				[i+100, {
					name: "hi",
					logo: "/api/teamLogo/1",
					rank: 2,
					solves: 0,
					penaltyMinutes: 0,
					problems: new Map(),
					members: [],
				}] as const),
		]),
	};
	return x;
});

export function ScoreboardPage() {
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

	const setScoreboard = useCallback((nsc: Scoreboard) =>
		setActualScoreboard(oldSc => {
			const newJudging: SolveEvent[] = [];
			for (const [k, v] of nsc.teams) {
				const oldTeam = oldSc?.teams.get(k);
				for (const [k2, v2] of v.problems) {
					const nev: SolveEvent = { teamId: k, problem: k2, sub: v2 };
					if (v2.ac == null) newJudging.push(nev);
					else if (oldTeam?.problems?.get(k2)?.ac != true && v2.ac == true && oldSc != null) {
						// if there's more than 1 solve in this update it won't look very nice but that's fine..
						setEvents(evs => [...evs, { solve: nev, newScoreboard: nsc }]);
					}
				}
			}

			setJudging(newJudging);
			return nsc;
		}), []);

	// useFeed("scoreboard", setScoreboard);
	// console.log(stringifyExtra(scoreboard));

	useEffect(() => {
		let i = 0;
		setScoreboard(replayParsed[i]);
		const int = setInterval(() => {
			console.log(i);
			i = (i+1)%replayParsed.length;
			setScoreboard(replayParsed[i]);
		}, 5000);
		return () => clearInterval(int);
	}, [setScoreboard]);

	if (scoreboard == null) return <Loading />;
	return <ScoreboardInner scoreboard={scoreboard} currentSolve={firstEv?.solve ?? null}
		focus={firstEv?.solve ?? judging[0] ?? null} />;
}
