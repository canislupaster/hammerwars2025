import { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ease } from "./ui";

export type ScrollData = { addScroller: (x: HTMLElement, off: number) => () => void };

type ScrollTarget = { offsets: HTMLElement[]; subOffset: HTMLElement } | null;

export function useScroll(
	{ duration, delay, delayBack, el, dir: orient, syncScroll, easeFn, startDir, stop }: {
		duration?: number;
		delay?: number;
		delayBack?: number;
		dir: "vert" | "horiz";
		startDir?: "forward" | "reverse";
		el?: HTMLElement | null;
		syncScroll?: boolean;
		easeFn?: (t: number) => number;
		stop?: boolean;
	},
): ScrollData {
	const [dir, setDir] = useState<"forward" | "reverse">(startDir ?? "reverse");
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
		if (target != null || stop == true) return;
		const tm = setTimeout(() => {
			setDir(dir == "forward" ? "reverse" : "forward");
		}, scrollDelay+scrollDuration);
		return () => clearTimeout(tm);
	}, [dir, scrollDelay, scrollDuration, target, stop]);

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
				const dt = stop == true ? 0 : Math.min(1, Math.max(0, (t-start2)/scrollDuration));
				const e = (easeFn ?? ease)(dt);
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
	}, [dir, easeFn, orient, scrollDelay, scrollDuration, stop, syncScroll, target]);

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

export function Scroller(
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
