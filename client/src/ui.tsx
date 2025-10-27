import { IconChevronDown, IconChevronUp, IconInfoCircleFilled, IconInfoTriangleFilled, IconLoader2,
	IconProps, IconX } from "@tabler/icons-preact";
import { cloneElement, ComponentChild, ComponentChildren, ComponentProps, ComponentType,
	createContext, createElement, CSSProperties, HeadingHTMLAttributes, HTMLAttributes, JSX, Ref,
	RefObject, VNode } from "preact";
import { ChangeEvent, createPortal, forwardRef } from "preact/compat";
import { useCallback, useContext, useEffect, useErrorBoundary, useId, useMemo, useRef,
	useState } from "preact/hooks";
import { ArrowContainer, Popover, PopoverState } from "react-tiny-popover";
import { twJoin, twMerge } from "tailwind-merge";
import { debounce, delay, fill } from "../../shared/util";

// dump of a bunch of UI & utility stuff ive written...

export const textColor = {
	contrast: "dark:text-white text-black",
	sky: "dark:text-sky-400 text-sky-700",
	green: "dark:text-green-500 text-green-700",
	red: "dark:text-red-500 text-red-700",
	default: "dark:text-zinc-50 text-zinc-800 dark:disabled:text-gray-400 disabled:text-gray-500",
	link:
		"text-gray-700 dark:text-gray-200 underline-offset-2 transition-colors hover:text-black dark:hover:text-gray-50 hover:bg-cyan-800/5 dark:hover:bg-cyan-100/5 cursor-pointer underline decoration-dashed decoration-1",
	blueLink: "dark:text-blue-200 text-sky-800",
	star: "dark:text-amber-400 text-amber-600",
	gray: "dark:text-gray-200 text-gray-700",
	dim: "dark:text-gray-400 text-gray-500",
	divider: "dark:text-gray-600 text-zinc-300",
	dimmer: "dark:text-gray-700 text-gray-300",
};

export const bgColor = {
	default: "dark:bg-zinc-800 bg-zinc-200 dark:disabled:bg-zinc-600",
	md: "dark:bg-neutral-900 dark:disabled:bg-neutral-800",
	hover: "dark:hover:bg-zinc-750 hover:bg-zinc-150 transition-colors",
	secondary: "dark:bg-zinc-900 bg-zinc-150",
	green: "dark:enabled:bg-green-800 enabled:bg-green-400",
	sky: "dark:enabled:bg-sky-900 enabled:bg-sky-300",
	red: "dark:enabled:bg-red-800 enabled:bg-red-300",
	rose: "dark:enabled:bg-rose-900 enabled:bg-rose-300",
	highlight: "dark:bg-yellow-800 bg-amber-200",
	highlight2: "dark:bg-teal-900 bg-cyan-200",
	restriction: "dark:bg-amber-900 bg-amber-100",
	divider: "dark:bg-gray-600 bg-zinc-300",
	contrast: "dark:bg-white bg-black",
	border: "bg-zinc-300 dark:bg-zinc-700",
};

export const borderColor = {
	default:
		"border-zinc-300 dark:border-zinc-600 disabled:bg-zinc-300 aria-expanded:border-blue-500 data-[selected=true]:border-blue-500",
	divider: "dark:border-gray-600 border-zinc-300",
	red: "border-red-400 dark:border-red-600",
	defaultInteractive:
		"border-zinc-300 hover:border-zinc-400 dark:border-zinc-600 dark:hover:border-zinc-500 disabled:bg-zinc-300 aria-expanded:border-blue-500 active:border-blue-500 dark:active:border-blue-500 data-[selected=true]:border-blue-500 transition-colors",
	blue: `hover:border-blue-500 dark:hover:border-blue-500 border-blue-500 dark:border-blue-500`,
	focus: `valid:focus:border-blue-500 valid:dark:focus:border-blue-500 focus:outline`,
};

export const outlineColor = {
	default: "active:outline theme:outline-blue-500 outline-offset-[-1px]",
};

export const containerDefault =
	`${textColor.default} ${bgColor.default} ${borderColor.default} border-[1.5px] rounded-none`;
export const invalidInputStyle =
	`bad:dark:bg-rose-900 bad:bg-rose-400 bad:theme:border-red-600 bad:focus:theme:outline-red-600`;
export const interactiveContainerDefault =
	`${textColor.default} ${bgColor.default} ${borderColor.defaultInteractive} ${outlineColor.default} ${invalidInputStyle} border-[1.5px] rounded-none`;

export type InputProps = {
	icon?: ComponentChildren;
	className?: string;
	valueChange?: (x: string) => void;
} & JSX.IntrinsicHTMLElements["input"];

export const Input = forwardRef<HTMLInputElement, InputProps>(
	({ className, icon, onInput, valueChange, ...props }, ref) => {
		const input = <input placeholder=" " type="text"
			className={twMerge(
				"w-full p-2 transition duration-300",
				icon != undefined && "pl-11",
				interactiveContainerDefault,
				borderColor.focus,
				className,
			)} onInput={onInput ?? (valueChange != undefined
				? (ev: InputEvent) => {
					valueChange((ev.currentTarget as HTMLInputElement).value);
				}
				: undefined)} ref={ref} {...props} />;

		if (icon != undefined) {
			return <div className="relative">
				{input}
				{icon != undefined
					&& <div className="absolute left-0 my-auto pl-3 top-0 bottom-0 flex flex-row items-center">
						{icon}
					</div>}
			</div>;
		}

		return input;
	},
);

export function HiddenInput(
	{ className, ...props }: JSX.IntrinsicHTMLElements["input"] & { className?: string },
) {
	return <input placeholder=" "
		className={twMerge(
			"bg-transparent border-0 outline-none border-b-2 focus:outline-none valid:focus:theme:border-blue-500 bad:theme:border-red-600 transition duration-300 px-1 py-px pb-0.5 h-fit",
			borderColor.default,
			className,
		)} {...props} />;
}

export function Textarea(
	{ className, children, ...props }: JSX.IntrinsicElements["textarea"] & { className?: string },
) {
	return <textarea
		className={twMerge(
			interactiveContainerDefault,
			borderColor.focus,
			"w-full p-2 transition duration-300 resize-y max-h-60 min-h-24",
			className,
		)}
		rows={6}
		tabIndex={100}
		{...props}>
		{children}
	</textarea>;
}

type ShortcutsProps = {
	onClick?: (ev: MouseEvent) => void;
	shortcut?: string;
	shortcuts?: string[];
	disabled?: boolean;
};

const ShortcutContext = createContext(
	undefined as unknown as React.MutableRefObject<Map<string, Set<() => void>>>,
);

export function useShortcuts({ shortcuts, shortcut, onClick, disabled }: ShortcutsProps) {
	const ctx = useContext(ShortcutContext);
	useEffect(() => {
		if (onClick && disabled != true) {
			const remove: (() => void)[] = [];
			for (const str of [...shortcuts ?? [], ...shortcut != undefined ? [shortcut] : []]) {
				const set = ctx.current.get(str) ?? new Set();
				const cb = () => onClick(new MouseEvent("click"));
				set.add(cb);
				ctx.current.set(str, set);
				remove.push(() => set.delete(cb));
			}
			return () => remove.forEach(cb => cb());
		}
	}, [ctx, disabled, onClick, shortcut, shortcuts]);
}

export type ButtonProps = JSX.IntrinsicElements["button"] & {
	icon?: ComponentChildren;
	iconRight?: ComponentChildren;
	disabled?: boolean;
	className?: string;
	loading?: boolean;
} & ShortcutsProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, loading, icon, iconRight, ...props }, ref) => {
		useShortcuts(props);
		return <button ref={ref}
			className={twMerge(
				twJoin(
					"flex flex-row justify-center gap-1 px-3 py-2 items-center group",
					interactiveContainerDefault,
				),
				className,
			)} {...props} disabled={loading == true || props.disabled == true}>
			{loading == true && <ThemeSpinner size="sm" />}
			{icon}
			{props.children}
			{iconRight}
		</button>;
	},
);

export const IconButton = (
	{ className, children, icon, ...props }: { icon: ComponentType<IconProps>; className?: string }
		& ShortcutsProps & JSX.IntrinsicElements["button"],
) => {
	useShortcuts(props);
	return <button
		className={twMerge(
			"rounded-sm p-1.5 flex items-center justify-center h-fit aspect-square",
			interactiveContainerDefault,
			className,
		)}
		{...props}>
		{createElement(icon, { size: 24 })}
		{children}
	</button>;
};

type AnchorProps = JSX.IntrinsicHTMLElements["a"] & ShortcutsProps & { className?: string };
export const anchorHover =
	"transition-all hover:text-black dark:hover:text-gray-50 hover:bg-cyan-100/5 enabled:cursor-pointer";
export const anchorUnderline =
	"text-gray-600 dark:text-zinc-50 underline decoration-dashed decoration-1 underline-offset-2";
export const anchorStyle = twJoin(anchorHover, anchorUnderline);

export const Anchor = forwardRef<HTMLAnchorElement, AnchorProps>(
	({ className, children, ...props }: AnchorProps, ref) => {
		useShortcuts(props);
		const classN = twMerge(anchorStyle, className);
		return <a ref={ref} className={classN} {...props}>{children}</a>;
	},
);

export const LinkButton = (
	{ className, icon, ...props }: JSX.IntrinsicHTMLElements["a"] & {
		icon?: ComponentChildren;
		className?: string;
	},
) =>
	<a
		className={twMerge(
			"flex flex-row gap-2 px-3 py-1.5 items-center rounded-none text-sm",
			interactiveContainerDefault,
			className,
		)}
		rel="noopener noreferrer"
		{...props}>
		{icon != undefined && <span className="inline-block h-4 w-auto">{icon}</span>}
		{props.children}
	</a>;

export const ThemeSpinner = (
	{ className, size }: { className?: string; size?: "sm" | "md" | "lg" | number },
) =>
	<IconLoader2 size={typeof size == "number" ? size : { sm: 24, md: 36, lg: 72 }[size ?? "md"]}
		className={twMerge(
			`animate-spin stroke-${
				{ sm: 1, md: 2, lg: 3 }[size ?? "md"]
			} dark:stroke-white stroke-blue-600`,
			className,
		)} />;

export const Loading = (
	{ children, ...props }: ComponentProps<typeof ThemeSpinner> & { children?: ComponentChildren },
) =>
	<div className="h-full w-full flex flex-col items-center justify-center py-16 px-20 gap-3">
		<ThemeSpinner size="lg" {...props} />
		{children}
	</div>;

export const chipColors = {
	red: "dark:bg-red-600 dark:border-red-400 bg-red-400 border-red-200",
	green: "dark:bg-green-600 dark:border-green-400 bg-green-400 border-green-200",
	blue: "dark:border-cyan-400 dark:bg-sky-600 border-cyan-200 bg-sky-400",
	gray: "dark:border-gray-300 dark:bg-gray-600 border-gray-100 bg-gray-300",
	purple: "dark:bg-purple-600 dark:border-purple-300 bg-purple-400 border-purple-300",
	teal: "dark:bg-[#64919b] dark:border-[#67cce0] bg-[#aedbe8] border-[#95e6fc]",
};

export const chipTextColors = {
	red: "text-red-400",
	green: "text-green-400",
	blue: "text-sky-400",
	gray: "text-gray-200",
	purple: "text-purple-400",
	teal: "text-teal-400",
};

export const chipColorKeys = Object.keys(chipColors) as (keyof typeof chipColors)[];

export const Chip = (
	{ className, color, ...props }: JSX.IntrinsicHTMLElements["span"] & {
		color?: keyof typeof chipColors;
		className?: string;
	},
) =>
	<span
		className={twMerge(
			"inline-block text-xs px-2 py-1 rounded-none border-solid border whitespace-nowrap",
			chipColors[color ?? "gray"],
			className,
		)}
		{...props}>
		{props.children}
	</span>;

export function capitalize(s: string) {
	const noCap = ["of", "a", "an", "the", "in"];
	return s.split(/\s+/g).filter(x => x.length > 0).map((x, i) => {
		if (i > 0 && noCap.includes(x)) return x;
		return `${x[0].toUpperCase()}${x.slice(1)}`;
	}).join(" ");
}

export const Alert = (
	{ title, txt, bad, className }: {
		title?: ComponentChildren;
		txt: ComponentChildren;
		bad?: boolean;
		className?: string;
	},
) =>
	<div
		className={twMerge(
			"border",
			bad ?? false
				? `${bgColor.red} ${borderColor.red}`
				: `${bgColor.default} ${borderColor.default}`,
			"p-2 px-4 rounded-sm flex flex-row gap-2",
			className,
		)}>
		<div className={twJoin("flex-shrink-0", title != undefined && "mt-1")}>
			{bad ?? false ? <IconInfoTriangleFilled /> : <IconInfoCircleFilled />}
		</div>
		<div>
			{title != undefined && <h2 className="font-bold font-big text-lg">{title}</h2>}
			<div className="flex flex-col gap-2">{txt}</div>
		</div>
	</div>;

export const Divider = (
	{ className, contrast, vert }: { className?: string; contrast?: boolean; vert?: boolean },
) =>
	<span
		className={twMerge(
			"shrink-0 block",
			vert == true ? "w-px h-5 self-center pb-1" : "w-full h-px my-2",
			contrast ?? false ? "dark:bg-gray-300 bg-gray-500" : bgColor.divider,
			className,
		)} />;

export const Card = (
	{ className, children, ...props }: HTMLAttributes<HTMLDivElement> & { className?: string },
) =>
	<div
		className={twMerge(
			"flex flex-col gap-1 rounded-none p-4 border-[1.5px] dark:border-zinc-700 shadow-md dark:shadow-black shadow-white/20 border-zinc-300",
			bgColor.md,
			className,
		)}
		{...props}>
		{children}
	</div>;

export function MoreButton(
	{ children, className, act: hide, down }: {
		act: () => void;
		children?: ComponentChildren;
		className?: string;
		down?: boolean;
	},
) {
	return <div className={twMerge("flex flex-col w-full items-center", className)}>
		<button onClick={hide}
			className={twJoin(
				"flex flex-col items-center cursor-pointer transition",
				down ?? false ? "hover:translate-y-1" : "hover:-translate-y-1",
			)}>
			{down ?? false
				? <>
					{children}
					<IconChevronDown />
				</>
				: <>
					<IconChevronUp />
					{children}
				</>}
		</button>
	</div>;
}

export const fadeGradient = {
	default: "from-transparent dark:to-neutral-950 to-zinc-100",
	primary: "from-transparent dark:to-zinc-800 to-zinc-200",
	secondary: "from-transparent dark:to-zinc-900 to-zinc-150",
};

export const GotoContext = createContext(
	undefined as {
		goto: (this: void, path: string) => void;
		addTransition(f: () => Promise<void>): Disposable;
	} | undefined,
);

export const TitleContext = createContext(
	undefined as { setTitle: (title: string) => () => void } | undefined,
);

export function useTitle(value: string) {
	const ctx = useContext(TitleContext)!.setTitle;
	useEffect(() => {
		return ctx(value);
	}, [ctx, value]);
}

// idk i usually use pushstate iirc or smh i guess not today!
export function useGoto() {
	return useContext(GotoContext)!.goto;
}
type ShowTransitionProps = {
	children: ComponentChild;
	open: boolean;
	openClassName?: string;
	closedClassName?: string;
	update?: (show: boolean, element: HTMLElement) => void;
};

export const ShowTransition = forwardRef<HTMLElement, ShowTransitionProps>(
	({ children, open, openClassName, closedClassName, update }, ref) => {
		const myRef = useRef<HTMLElement>(null);
		const [show2, setShow] = useState(false);
		const show = show2 || open;

		const cls = (open ? openClassName : closedClassName)?.split(" ") ?? [];
		const removeCls = (open ? closedClassName : openClassName)?.split(" ") ?? [];

		const goto = useContext(GotoContext);
		useEffect(() => {
			const el = myRef.current;
			if (!show) return;
			if (!el) {
				console.warn("transition element not mounted despite shown");
				return;
			}

			// wait for animations to begin, and then wait for all to end
			let enabled = true;
			const wait = async () => {
				for (;;) {
					await delay(100);
					if (!enabled) break;

					const anims = el.getAnimations({ subtree: true }).filter(anim =>
						anim.playState != "finished"
					);
					if (anims.length == 0) {
						update?.(open, el);
						setShow(open);
						return true;
					}

					await Promise.allSettled(anims.map(x => x.finished));
				}

				return false;
			};

			if (open) {
				setShow(true);
				update?.(true, el);
			} else {
				void wait();
			}

			el.classList.remove(...removeCls);
			el.classList.add(...cls);

			const t = !open ? null : goto?.addTransition(async () => {
				el.classList.remove(...cls);
				el.classList.add(...removeCls);
				await wait();
			});

			return () => {
				enabled = false;
				t?.[Symbol.dispose]();
			};
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [open, show]);

		const cloneRef = useCloneRef(ref, myRef);
		if (children == undefined || !show) return <></>;
		return cloneElement(children as VNode, { ref: cloneRef });
	},
);

// init=true -> dont animate expanding initially
export const Collapse = forwardRef<
	HTMLDivElement,
	JSX.IntrinsicElements["div"] & {
		open?: boolean;
		init?: boolean;
		speed?: number;
		update?: (show: boolean) => void;
	}
>(({ children, open, className, style, init, speed, update, ...props }, ref) => {
	const myRef = useRef<HTMLDivElement>(null);
	const innerRef = useRef<HTMLDivElement>(null);
	const initCollapse = useRef(init != true);

	const [showInner, setShowInner] = useState(open != false);
	useEffect(() => update?.(showInner), [showInner, update]);

	useEffect(() => {
		const main = myRef.current, inner = innerRef.current;
		if (!main || !inner) return;

		let frame: number | null;
		setShowInner(main.clientHeight > 0 || open != false);

		let lt: number | null = null;
		const cb = () =>
			requestAnimationFrame(t => {
				const dt = Math.min(t-(lt ?? t), 50);
				const style = getComputedStyle(main);
				const mainInnerHeight =
					main.clientHeight-parseFloat(style.paddingBottom)-parseFloat(style.paddingTop);
				const d = (open == false ? 0 : inner.clientHeight)-mainInnerHeight;
				const done = !initCollapse.current || Math.abs(d) < 1;
				initCollapse.current = true;
				let newH = (done ? d : d*dt*(speed ?? 1)/100)+parseFloat(style.height);
				if (d < 0) newH = Math.floor(newH);
				else newH = Math.ceil(newH);

				main.style.height = px(newH);

				lt = t;
				if (done) frame = lt = null;
				else frame = cb();
				if (done && open == false) setShowInner(false);
			});

		let tm: number | null = null;
		const observer = new ResizeObserver(() => {
			if (frame == null) {
				if (tm != null) clearTimeout(tm);
				tm = setTimeout(() => frame = cb(), 100);
			}
		});

		observer.observe(inner);

		frame = cb();

		return () => {
			observer.disconnect();
			if (tm != null) clearTimeout(tm);
			if (frame != null) cancelAnimationFrame(frame);
		};
	}, [open, speed]);

	return <div ref={useCloneRef(ref, myRef)}
		className={twMerge("overflow-hidden", className as string)}
		style={{ ...style as CSSProperties, height: "1px" }} {...props}>
		<div ref={innerRef}>{showInner && children}</div>
	</div>;
});

export function ShowMore(
	{ children, className, maxh, forceShowMore, inContainer }: {
		children: ComponentChildren;
		className?: string;
		maxh?: string;
		forceShowMore?: boolean;
		inContainer?: "primary" | "secondary";
	},
) {
	const [showMore, setShowMore] = useState<boolean | null>(false);
	const inner = useRef<HTMLDivElement>(null), ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const a = inner.current!, b = ref.current!;
		const check = () => {
			const disableShowMore = forceShowMore != true && a.scrollHeight <= b.clientHeight+100;
			setShowMore(showMore => disableShowMore ? null : (showMore ?? false));
		};

		const observer = new ResizeObserver(check);
		observer.observe(a);
		observer.observe(b);
		return () => observer.disconnect();
	}, [forceShowMore]);

	const expanded = showMore == null || showMore == true || forceShowMore == true;

	return <Collapse init>
		<div className={className}>
			<div ref={ref} className={`relative ${expanded ? "" : "max-h-52 overflow-y-hidden"}`}
				style={{ maxHeight: expanded ? undefined : maxh }}>
				<div ref={inner} className={expanded ? "overflow-y-auto max-h-dvh" : ""}>{children}</div>

				{!expanded && <div className="absolute bottom-0 left-0 right-0 z-40">
					<MoreButton act={() => setShowMore(true)} down>Show more</MoreButton>
				</div>}

				{!expanded
					&& <div
						className={`absolute bottom-0 h-14 max-h-full bg-gradient-to-b z-20 left-0 right-0 ${
							fadeGradient[inContainer ?? "default"]
						}`} />}
			</div>

			{showMore == true && <MoreButton act={() => {
				ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
				setShowMore(false);
			}} className="pt-2">
				Show less
			</MoreButton>}
		</div>
	</Collapse>;
}

type TextVariants = "big" | "lg" | "md" | "dim" | "bold" | "normal" | "err" | "sm" | "smbold"
	| "code";
export function Text(
	{ className, children, v, ...props }: HTMLAttributes<HTMLSpanElement> & HeadingHTMLAttributes<
		HTMLHeadingElement
	> & HTMLAttributes<HTMLParagraphElement> & { v?: TextVariants; className?: string },
) {
	switch (v) {
		case "big":
			return <h1
				className={twMerge(
					"md:text-3xl text-2xl font-big font-black",
					textColor.contrast,
					className,
				)}
				{...props}>
				{children}
			</h1>;
		case "bold":
			return <b className={twMerge("text-lg font-bold", textColor.contrast, className)} {...props}>
				{children}
			</b>;
		case "smbold":
			return <b
				className={twMerge("text-sm font-semibold text-gray-700 dark:text-gray-300", className)}
				{...props}>
				{children}
			</b>;
		case "md":
			return <h3 className={twMerge("text-xl font-big font-bold", textColor.contrast, className)}
				{...props}>
				{children}
			</h3>;
		case "lg":
			return <h3
				className={twMerge("text-2xl font-big font-extrabold", textColor.contrast, className)}
				{...props}>
				{children}
			</h3>;
		case "dim":
			return <span className={twMerge("text-sm text-gray-500 dark:text-gray-400", className)}
				{...props}>
				{children}
			</span>;
		case "sm":
			return <p className={twMerge("text-sm text-gray-800 dark:text-gray-200", className)}
				{...props}>
				{children}
			</p>;
		case "code":
			return <code
				className={twMerge(
					"break-all text-gray-800 dark:text-gray-200 font-semibold rounded-sm p-0.5 whitespace-pre-wrap",
					bgColor.md,
					className,
				)}
				{...props}>
				{children}
			</code>;
		case "err":
			return <span className={twMerge("text-red-500", className)} {...props}>{children}</span>;
		default:
			return <p className={className} {...props}>{children}</p>;
	}
}

const ModalContext = createContext<null | RefObject<HTMLDialogElement | null>>(null);
export const px = (x: number | undefined) => x != undefined ? `${x}px` : "";

function ModalBackground({ className, bgClassName }: { className?: string; bgClassName?: string }) {
	const [dims, setDims] = useState<
		null | {
			nx: number;
			ny: number;
			side: number;
			offY: number;
			iy: number;
			offX: number;
			ix: number;
			top: number;
			left: number;
			height: number;
			width: number;
		}
	>(null);
	const modalCtx = useContext(ModalContext);
	useEffect(() => {
		const el = modalCtx?.current;
		if (!el) return;
		const cb = () => {
			const nx = Math.ceil(10*el.clientWidth/window.innerWidth)+1;
			const side = Math.ceil(el.clientWidth/nx);
			const ny = Math.ceil(el.clientHeight/side)+1;
			const rect = el.getBoundingClientRect();
			setDims({
				nx,
				ny,
				side,
				offX: el.scrollLeft%side,
				offY: el.scrollTop%side,
				ix: Math.floor(el.scrollLeft/side),
				iy: Math.floor(el.scrollTop/side),
				height: rect.height,
				width: rect.width,
				left: rect.left,
				top: rect.top,
			});
		};

		const observer = new ResizeObserver(cb);
		observer.observe(el);
		el.addEventListener("scroll", cb);
		window.addEventListener("resize", cb);
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", cb);
			window.removeEventListener("resize", cb);
			setDims(null);
		};
	}, [modalCtx]);

	return <div className={twMerge("-z-10 rounded-none fixed overflow-clip border", className)}
		style={{
			width: px(dims?.width),
			height: px(dims?.height),
			top: px(dims?.top),
			left: px(dims?.left),
		}}>
		{dims && fill(dims.nx, i =>
			fill(dims.ny, j => {
				return <div key={(j+dims.iy)*dims.nx+i+dims.ix}
					className={twMerge(
						"in-[.show]:animate-[fade-in_200ms_forwards] opacity-0 in-[.not-show]:animate-[fade-out_10ms_forwards] absolute",
						bgClassName,
					)}
					style={{
						animationFillMode: "both",
						animationDelay: `${20*(j*dims.nx*0.5+i)}ms`,
						top: px(j*dims.side-dims.offY),
						left: px(i*dims.side-dims.offX),
						width: px(dims.side),
						height: px(dims.side),
					}} />;
			})).flat()}
	</div>;
}

export const transparentNoHover =
	"[:not(:hover)]:theme:bg-transparent [:not(:hover)]:border-transparent";

// not very accessible 🤡
export function Modal(
	{ bad, open, onClose, closeButton, title, children, className, ...props }: {
		bad?: boolean;
		open: boolean;
		onClose?: () => void;
		closeButton?: boolean;
		title?: ComponentChildren;
		children?: ComponentChildren;
		className?: string;
	} & JSX.IntrinsicHTMLElements["dialog"],
) {
	const modalRef = useRef<HTMLDialogElement>(null);
	const [show, setShow] = useState(false);
	const setToastRoot = useContext(ToastContext)?.setToastRoot;
	useEffect(() => {
		if (!show) return;
		const el = modalRef.current!;
		const disp = setToastRoot?.(el);
		// showmodal is not needed and ruins transition (what the hell)
		el.showModal();
		return () => {
			disp?.();
			el.close();
		};
	}, [setToastRoot, show]);

	useEffect(() => {
		modalRef.current?.showModal();
	}, [open]);

	return <ShowTransition open={open} openClassName="show" closedClassName="not-show"
		update={setShow} ref={modalRef}>
		<dialog
			className={twMerge(
				"bg-transparent opacity-0 [:not(.show)]:pointer-events-none transition-opacity duration-500 mx-auto md:mt-[15dvh] mt-10 text-inherit outline-none rounded-none z-50 p-5 pt-4 container flex items-stretch flex-col max-h-[calc(min(50rem,70dvh))] overflow-auto fixed left-0 top-0 md:max-w-2xl right-0 gap-2 group [.show]:opacity-100 [.show]:pointer-events-auto",
				className,
			)}
			onClose={ev => {
				ev.preventDefault();
				onClose?.();
			}}
			{...props}>
			<ModalContext.Provider value={modalRef}>
				{onClose && closeButton != false
					&& <IconButton icon={IconX}
						className={twJoin("absolute top-3 right-2 z-30", transparentNoHover)} onClick={() =>
						onClose()} />}

				{title != undefined && <>
					<Text v="big" className="pr-8">{title}</Text>
					<div className="my-0">
						<Divider
							className={twJoin("absolute left-0 right-0 my-auto", bad != true && bgColor.border)}
							contrast={bad} />
					</div>
				</>}

				{children}

				<ModalBackground className={bad ?? false ? borderColor.red : borderColor.default}
					bgClassName={bad ?? false ? bgColor.red : bgColor.md} />
				<div className="fixed bg-black/30 left-0 right-0 top-0 bottom-0 -z-20"
					onClick={() => onClose?.()} />
			</ModalContext.Provider>
		</dialog>
	</ShowTransition>;
}

const PopupCountCtx = createContext({
	count: 0,
	incCount(this: void): number {
		return 0;
	},
});

export const useClosePopup = () => {
	const { incCount } = useContext(PopupCountCtx);
	return () => incCount();
};

// number of args shouldn't change
export function useCloneRef<T>(...refs: (Ref<T> | undefined)[]): (x: T | null) => void {
	return useCallback(x => {
		for (const r of refs) {
			if (typeof r == "function") r(x);
			else if (r != null) r.current = x;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...refs]);
}

// opens in modal if already in tooltip...
export const AppTooltip = forwardRef(
	(
		{ content, children, placement, className, onOpenChange, noClick, noHover, disabled, ...props }:
			& {
				content: ComponentChild;
				placement?: ComponentProps<typeof Popover>["positions"];
				onOpenChange?: (x: boolean) => void;
				noClick?: boolean;
				noHover?: boolean;
				disabled?: boolean;
				className?: string;
			}
			& Omit<HTMLAttributes<HTMLDivElement>, "content">,
		ref,
	) => {
		const [open, setOpen] = useState<number>(0);
		const [reallyOpen, setReallyOpen] = useState<number | null>(null);
		const { count, incCount } = useContext(PopupCountCtx);

		const unInteract = useCallback((p: PointerEvent) => {
			if (p.pointerType == "mouse") setOpen(0);
		}, [setOpen]);

		const isOpen = disabled != true && reallyOpen == count;

		const interact = useCallback((p: PointerEvent) => {
			if (p.pointerType == "mouse") setOpen(i => i+1);
		}, [setOpen]);

		useEffect(() => {
			let tm: number;
			if (open > 0) tm = setTimeout(() => setReallyOpen(incCount()), 200);
			else tm = setTimeout(() => setReallyOpen(null), 500);
			return () => clearTimeout(tm);
		}, [incCount, open]);

		useEffect(() => {
			onOpenChange?.(isOpen);
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [isOpen, setOpen]);

		const targetRef = useRef<HTMLDivElement>(null);

		useEffect(() => {
			const noCb = () => {};
			const cbs = [["pointerenter", noHover ?? false ? noCb : interact], [
				"pointerleave",
				noHover ?? false ? noCb : unInteract,
			], [
				"click",
				noClick ?? false ? noCb : (ev: PointerEvent) => {
					if (!isOpen) {
						setOpen(i => i+1);
						setReallyOpen(incCount());
					} else {
						setOpen(0);
						setReallyOpen(null);
					}
					ev.stopPropagation();
				},
			]] as const;

			const elem = targetRef.current!;
			for (const [k, v] of cbs) elem.addEventListener(k, v as () => void);
			return () => {
				for (const [k, v] of cbs) elem.removeEventListener(k, v as () => void);
			};
		}, [incCount, interact, isOpen, noClick, noHover, reallyOpen, unInteract]);

		const [uncollapsed, setUncollapsed] = useState(false);

		return <Popover ref={useCloneRef(targetRef, ref)} onClickOutside={() => incCount()}
			positions={placement ?? ["top", "right", "left", "bottom"]}
			containerStyle={{ zIndex: "100000" }} padding={5}
			parentElement={useContext(ModalContext)?.current ?? undefined}
			content={({ position, childRect, popoverRect }: PopoverState) => {
				if (!position) return <></>;
				const c = position[0];
				const borderClass =
					{
						r: "border-r-zinc-300! dark:border-r-zinc-600!",
						l: "border-l-zinc-300! dark:border-l-zinc-600!",
						t: "border-t-zinc-300! dark:border-t-zinc-600!",
						b: "border-b-zinc-300! dark:border-b-zinc-600!",
					}[c];

				return <ArrowContainer position={position} childRect={childRect} popoverRect={popoverRect}
					arrowClassName={borderClass} arrowSize={7} arrowColor="">
					<Collapse className={twMerge(containerDefault, "p-2 py-1", className)}
						update={setUncollapsed} onPointerEnter={interact} onPointerLeave={unInteract}
						open={isOpen} tabIndex={0} {...props}>
						{content}
					</Collapse>
				</ArrowContainer>;
			}} containerClassName="max-w-96" isOpen={isOpen || uncollapsed}>
			{children}
		</Popover>;
	},
);

export type DropdownPart =
	& ({ type: "txt"; txt?: ComponentChildren } | { type: "big"; txt?: ComponentChildren } | {
		type: "act";
		name?: ComponentChildren;
		// true -> close
		act: () => boolean;
		disabled?: boolean;
		active?: boolean;
	})
	& { key?: string | number };

export function Dropdown(
	{ parts, trigger, className, onOpenChange, ...props }: {
		trigger?: ComponentChildren;
		parts: DropdownPart[];
	} & Partial<ComponentProps<typeof AppTooltip>>,
) {
	const [keySel, setKeySel] = useState<string | number | null>(null);
	const [focusSel, setFocusSel] = useState<boolean>(false);

	const acts = parts.map((v, i) => ({ key: v.key ?? i, type: v.type })).filter(v =>
		v.type == "act"
	);
	const idx = keySel != null ? acts.findIndex(p => p.key == keySel) : -1;

	const [open, setOpen] = useState(false);
	const ctx = useContext(PopupCountCtx);

	const keyCb = (ev: KeyboardEvent) => {
		if (!open) return;

		if (ev.key == "ArrowDown" && acts.length) {
			const nidx = idx == -1 ? 0 : (idx+1)%acts.length;
			setKeySel(acts[nidx].key);
			setFocusSel(true);
		} else if (ev.key == "ArrowUp" && acts.length) {
			const pidx = idx == -1 ? acts.length-1 : (idx+acts.length-1)%acts.length;
			setKeySel(acts[pidx].key);
			setFocusSel(true);
		} else if (ev.key == "Escape") {
			ctx.incCount();
		} else {
			return;
		}

		ev.preventDefault();
	};

	return <AppTooltip placement={["bottom", "top"]} onOpenChange={v => {
		setOpen(v);
		onOpenChange?.(v);
	}} className="px-0 py-0 max-w-60 overflow-y-auto justify-start max-h-[min(80dvh,20rem)] min-w-20"
		content={parts.map((x, i) => {
			if (x.type == "act") {
				return <Button key={x.key ?? i} disabled={x.disabled}
					className={`m-0 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t border-x-0 dark:hover:bg-zinc-700 hover:bg-zinc-300 w-full hover:outline hover:theme:border-b-transparent [&:not(:focus)]:hover:dark:outline-zinc-600 [&:not(:focus)]:hover:outline-zinc-400 rounded-none transition-none ${
						x.active == true ? "dark:bg-zinc-950 bg-zinc-200" : ""
					} ${outlineColor.default}`} onBlur={(x.key ?? i) == keySel
					? () => setFocusSel(false)
					: undefined} ref={(el: HTMLButtonElement | null) => {
					if ((x.key ?? i) == keySel && el != null && focusSel) {
						el.focus();
					}
				}} onClick={() => {
					if (x.act()) ctx.incCount();
				}}>
					{x.name}
				</Button>;
			} else if (x.type == "txt") {
				return <div key={x.key ?? i}
					className="flex flex-row justify-center gap-4 dark:bg-zinc-900 bg-zinc-100 items-center border m-0 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none w-full">
					{x.txt}
				</div>;
			}

			return <div key={x.key ?? i}
				className="flex flex-row justify-start gap-4 p-2 dark:bg-zinc-900 bg-zinc-100 items-center border m-0 dark:border-zinc-700 border-zinc-300 border-t-0 first:border-t rounded-none w-full">
				{x.txt}
			</div>;
		})} onKeyDown={keyCb} {...props}>
		<div className={className}>{trigger}</div>
	</AppTooltip>;
}

// mounted in popover
// if it focuses too soon, then popover has not measured itself yet and we scroll to a random ass place
// what the fuck.
function LazyAutoFocusSearch(
	{ search, setSearch, onSubmit }: {
		search: string;
		setSearch: (x: string) => void;
		onSubmit?: () => void;
	},
) {
	const ref = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const t = setTimeout(() => ref.current?.focus(), 50);
		return () => clearTimeout(t);
	}, []);

	return <form className="w-full" onSubmit={ev => {
		onSubmit?.();
		ev.preventDefault();
	}}>
		<Input placeholder="Search..." ref={ref} className="py-1" value={search}
			valueChange={setSearch} />
	</form>;
}

export function Select<T>(
	{ children, options, value, setValue, placeholder, className, disabled, searchable, ...props }: {
		options: {
			label: ComponentChildren;
			search?: string;
			value?: T;
			key?: string | number;
			disabled?: boolean;
		}[];
		value?: T;
		setValue?: (x: T) => void;
		placeholder?: ComponentChildren;
		searchable?: boolean;
		className?: string;
		disabled?: boolean;
	} & Partial<ComponentProps<typeof Dropdown>>,
) {
	const [search, setSearch] = useState("");
	const curOpt = value == undefined ? undefined : options.find(x => x.value == value);
	const parts: DropdownPart[] = useMemo(() => {
		const s = toSearchString(search);
		return options.filter(v => {
			const l = typeof v.label == "string" ? v.label : v.search;
			if (l != undefined) return toSearchString(l).includes(s);
			return true;
		}).map(opt => {
			const v = opt.value;
			return v == undefined
				? { type: "txt", txt: opt.label, key: opt.key }
				: {
					type: "act",
					name: opt.label,
					active: opt.value == value,
					disabled: opt.disabled,
					act() {
						setValue?.(v);
						return true;
					},
					key: opt.key,
				};
		});
	}, [options, search, setValue, value]);

	const ctx = useContext(PopupCountCtx);
	return <Dropdown noHover trigger={children != undefined ? children : <div>
		<Button className={twMerge("pr-2 pl-2 py-1 min-w-0 gap-1", className)} disabled={disabled}
			type="button">
			<div className="basis-16 grow whitespace-nowrap overflow-hidden max-w-xs">
				{curOpt == undefined ? placeholder : curOpt.label}
			</div>
			<IconChevronDown size={24} />
		</Button>
	</div>}
		parts={[
			...searchable != true
				? []
				: [
					{
						type: "txt",
						txt: <LazyAutoFocusSearch search={search} setSearch={setSearch} onSubmit={() => {
							if (parts.length > 0 && parts[0].type == "act") {
								if (parts[0].act()) ctx.incCount();
							}
						}} />,
						key: "search",
					} as const,
				],
			...parts,
		]} onOpenChange={() => setSearch("")}
		className={twMerge("w-fit", children != undefined && className)} {...props} />;
}

export type Theme = "light" | "dark";
export const ThemeContext = createContext<{ theme: Theme; setTheme: (x: Theme) => void }>(
	undefined as never,
);
export const useTheme = () => useContext(ThemeContext).theme;

const ToastContext = createContext(
	undefined as {
		pushToast: (this: void, x: string) => void;
		setToastRoot: (root: HTMLElement) => () => void;
	} | undefined,
);

export function useToast() {
	return useContext(ToastContext)!.pushToast;
}

export function Container(
	{ children, className, ...props }: { children?: ComponentChildren; className?: string }
		& HTMLAttributes<HTMLDivElement>,
) {
	const [count, setCount] = useState(0);
	const incCount = useCallback(() => {
		let r: number;
		setCount(x => {
			return r = x+1;
		}); // look away child
		return r!;
	}, [setCount]);

	const toastKey = useRef(1);
	const [toasts, setToasts] = useState<[number, string][]>([[0, ""]]);
	useEffect(() => {
		if (toasts.length <= 1) return;
		const tm = setTimeout(() => {
			setToasts(toasts.toSpliced(0, 1));
		}, 2000);
		return () => clearTimeout(tm);
	}, [toasts]);

	const titlesRef = useRef<string[]>([document.title]);
	const [toastRoot, setToastRoot] = useState<HTMLElement | null>(null);

	const shortcutsRef = useRef(new Map<string, Set<() => void>>());
	useEffect(() => {
		const shortcuts = shortcutsRef.current;
		const listener = (ev: KeyboardEvent) => {
			if (
				ev.target instanceof HTMLElement
				&& (["INPUT", "TEXTAREA", "SELECT", "DIALOG", "BUTTON"].includes(ev.target.tagName)
					|| ev.target.contentEditable == "true")
			) return;

			const keyStr: string[] = [];
			if (ev.metaKey) keyStr.push("cmd");
			if (ev.ctrlKey) keyStr.push("ctrl");
			if (ev.shiftKey) keyStr.push("shift");
			if (ev.altKey) keyStr.push("alt");

			keyStr.push((ev.key.startsWith("Key") ? ev.key.slice("Key".length) : ev.key).toLowerCase());

			const set = shortcuts.get(keyStr.join("-")) ?? new Set();
			if (set.size > 0) {
				set.forEach(cb => cb());
				ev.preventDefault();
			}
		};

		document.addEventListener("keydown", listener);
		return () => document.removeEventListener("keydown", listener);
	}, [shortcutsRef]);

	const inner = <>
		{createPortal(
			<div className="dark font-body fixed bottom-5 left-2 px-10 z-[12000] flex flex-col items-start gap-3">
				{toasts.map((x, i) =>
					<ShowTransition key={x[0]} open={i != 0} openClassName="opacity-100"
						closedClassName="opacity-0">
						<div
							className={twMerge(
								containerDefault,
								bgColor.sky,
								"p-2 pl-5 gap-5 flex flex-row items-center transition-opacity duration-1000",
							)}>
							{x[1]}
							<button className="ml-auto" onClick={() => {
								setToasts(xs => xs.filter(y => y[0] != x[0]));
							}}>
								<IconX />
							</button>
						</div>
					</ShowTransition>
				)}
			</div>,
			toastRoot ?? document.body,
		)}

		<div
			className={twMerge(
				"font-body dark:text-gray-100 text-gray-950 min-h-dvh relative",
				className,
			)}
			{...props}>
			{children}
			<div className="bg-neutral-950 absolute left-0 top-0 bottom-0 right-0 -z-50" />
		</div>
	</>;

	return <ShortcutContext.Provider value={shortcutsRef}>
		<TitleContext.Provider value={useMemo(() => ({
			setTitle(title) {
				const arr = titlesRef.current;
				const i = arr.length;
				arr.push(document.title = title);

				return () => {
					while (i < arr.length) arr.pop();
					document.title = arr[arr.length-1];
				};
			},
		}), [])}>
			<PopupCountCtx.Provider value={{ count, incCount }}>
				<ToastContext.Provider value={{
					pushToast: useCallback((toast: string) => {
						setToasts(xs => [...xs.slice(0, 3), [toastKey.current++, toast]]);
					}, []),
					setToastRoot: useCallback((el: HTMLElement) => {
						setToastRoot(el);
						return () => setToastRoot(old => el == old ? null : old);
					}, []),
				}}>
					{inner}
				</ToastContext.Provider>
			</PopupCountCtx.Provider>
		</TitleContext.Provider>
	</ShortcutContext.Provider>;
}

export const toSearchString = (x: string) => x.toLowerCase().replace(/[^a-z0-9\n]/g, "");

export function useMediaQuery(q: MediaQueryList | string | null, init: boolean = false) {
	const [x, set] = useState(init);

	useEffect(() => {
		if (q == null) return;

		const mq = typeof q == "string" ? window.matchMedia(q) : q;
		const cb = () => set(mq.matches);
		mq.addEventListener("change", cb);
		set(mq.matches);
		return () => mq.removeEventListener("change", cb);
	}, [q]);

	return x;
}

const queries: Record<"md" | "lg", MediaQueryList | null> = {
	md: window.matchMedia("(min-width: 768px)"),
	lg: window.matchMedia("(min-width: 1024px)"),
};

export const useMd = () => {
	return useMediaQuery(queries.md, true);
};

export const useLg = () => {
	return useMediaQuery(queries.lg, true);
};

export function ErrorPage({ error, retry }: { error?: Error; retry?: () => void }) {
	return <div className="flex flex-col items-center gap-10 h-full py-10 justify-center mx-5">
		<IconInfoTriangleFilled size={70} className="fill-red-500" />
		<div className="flex flex-col gap-2 max-w-md">
			<Text v="big">An error occurred</Text>
			<p>It{"'"}s never too late to try again. {!retry && "Refresh the page."}</p>

			{retry && <Button onClick={() => retry()}>Retry</Button>}

			{error?.message != undefined && <Text v="sm">Details: {error.message}</Text>}
		</div>
	</div>;
}

export function withTimeout<T extends unknown[], R>(
	f: (...args: T) => Promise<R>,
	timeout: number,
): typeof f {
	return (...args) =>
		Promise.race([
			new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timed out")), timeout)),
			f(...args),
		]);
}

export const abbr = (s: string, len: number = 300) =>
	s.length > len ? `${s.substring(0, len-3)}...` : s;

export function useAsync<T extends unknown[], R>(
	f: (...args: T) => Promise<R>,
	opts?: { propagateError?: boolean },
): {
	run: (...args: T) => void;
	attempted: boolean;
	loading: boolean;
	error: Error | null;
	result: R | null;
} {
	const [state, setState] = useState<
		{ loading: boolean; attempted: boolean; error: Error | null; result: R | null }
	>({ loading: false, attempted: false, error: null, result: null });

	const propError = opts?.propagateError ?? true;
	useEffect(() => {
		if (propError && state.error) throw state.error;
	}, [state.error, propError]);

	return useMemo(() => ({
		run(...args) {
			if (!state.loading) {
				setState(s => ({ ...s, loading: true, attempted: true }));

				f(...args).then(res => {
					setState(s => ({ ...s, result: res }));
				}, err => {
					setState(s => ({ ...s, error: err instanceof Error ? err : new Error("Unknown error") }));
				}).finally(() => {
					setState(s => ({ ...s, loading: false }));
				});
			}
		},
		...state,
	}), [f, state]);
}

export function listener<E extends HTMLElement, K extends keyof HTMLElementEventMap>(
	elem: E,
	handler: { type: K | K[]; f: (this: Element, event: HTMLElementEventMap[K]) => void },
) {
	const typeArr = Array.isArray(handler.type) ? handler.type : [handler.type];
	for (const ty of typeArr) elem.addEventListener(ty, handler.f);
	return {
		[Symbol.dispose]() {
			for (const ty of typeArr) elem.removeEventListener(ty, handler.f);
		},
	};
}

export function useDisposable<T extends Disposable>(
	effect: () => T | null,
	deps?: unknown[],
): T | null {
	const [t, setT] = useState<T | null>(null);
	useEffect(() => {
		const obj = effect();
		setT(obj);
		return () => {
			obj?.[Symbol.dispose]();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
	return t;
}

export type SetFn<T> = (cb: (old: T) => T) => void;

export function ConfirmModal(
	{ title, actionName, children, open, onClose, confirm, defaultYes }: {
		title?: string;
		children?: ComponentChildren;
		open: boolean;
		onClose: () => void;
		confirm: () => void;
		defaultYes?: boolean;
		actionName?: string;
	},
) {
	return <Modal open={open} onClose={() => onClose()} title={title ?? "Are you sure?"}
		className="flex flex-col gap-2">
		<form onSubmit={ev => {
			ev.preventDefault();
			if (defaultYes == true) confirm();
			onClose();
		}} className="contents">
			{children}
			<div className="flex flex-row gap-2">
				<Button className={bgColor.red} onClick={() => {
					onClose();
					confirm();
				}} autofocus={defaultYes}>
					{actionName ?? title ?? "Confirm"}
				</Button>
				<Button autofocus={defaultYes != true} type="button" onClick={() => onClose()}>
					Cancel
				</Button>
			</div>
		</form>
	</Modal>;
}

export function AlertErrorBoundary({ children }: { children?: ComponentChildren }) {
	const [err, reset] = useErrorBoundary(err => {
		console.error("alert error boundary", err);
	}) as [unknown, () => void];

	if (err != undefined) {
		return <Alert bad title="An error occurred" txt={
			<>
				<Text>{err instanceof Error ? `Details: ${err.message}` : "Unknown error"}</Text>
				<Button onClick={() => reset()} className="self-start">Retry</Button>
			</>
		} />;
	}

	return children;
}

export function ease(x: number): number {
	return x < 0.5 ? 16*x*x*x*x*x : 1-Math.pow(-2*x+2, 5)/2;
}

export function useValidity(
	value: string,
	callback: (v: string) => void,
): {
	value: string;
	onBlur: (ev: FocusEvent) => void;
	onChange: (ev: ChangeEvent<HTMLInputElement>) => void;
} {
	const db = useDisposable(() => debounce(200), []);
	const [v, setV] = useState<{ editing: boolean; value: string | null }>({
		editing: false,
		value: null,
	});
	const check = (elem: HTMLInputElement, editing: boolean) => {
		if (elem.value != v.value || v.editing) setV({ editing, value: elem.value });
		if (elem.checkValidity()) {
			const txt = elem.value;
			db!.call(() => {
				callback(txt);
				if (!editing) setV({ editing: false, value: null });
			});
		} else if (!editing) setV({ editing: false, value: null });
	};

	return {
		value: v.value ?? value,
		onBlur(ev) {
			check(ev.currentTarget as HTMLInputElement, false);
		},
		onChange(ev) {
			const el = ev.currentTarget;
			check(el, true);
		},
	};
}

export function FadeRoute(
	{ className, ...props }: JSX.IntrinsicElements["div"] & { className?: string },
) {
	const ctx = useContext(GotoContext);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		let anim: Animation | null = null;
		const trans = ctx!.addTransition(async () => {
			anim?.cancel();
			anim = await el.animate([{ opacity: 1 }, { opacity: 0 }], {
				duration: 500,
				fill: "forwards",
				iterations: 1,
			}).finished;
		});

		return () => {
			trans[Symbol.dispose]();
			anim?.cancel();
		};
	}, [ctx]);

	return <div {...props} className={twMerge("animate-fade-in w-full", className)} ref={ref} />;
}

export function Checkbox(
	{ label, checked, valueChange, disabled, className }: {
		label?: ComponentChildren;
		checked?: boolean;
		valueChange?: (value: boolean) => void;
		disabled?: boolean;
		className?: string;
	},
) {
	const id = useId();
	return <label htmlFor={id}
		className={[
			"group inline-flex items-center gap-3 select-none",
			disabled == true ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
		].join(" ")}>
		<input id={id} type="checkbox" className="peer sr-only" checked={checked}
			onChange={e => valueChange?.(e.currentTarget.checked)} disabled={disabled} />
		<span aria-hidden
			className={twMerge(
				interactiveContainerDefault,
				"valid:peer-focus:border-blue-500 peer-focus:outline relative h-6 aspect-square",
				className,
			)}>
			<span
				className={twJoin(
					"absolute top-[20%] left-[20%] transition-transform w-[60%] h-[60%] bg-neutral-100",
					checked == true ? "scale-100" : "scale-0",
				)} />
		</span>
		{label != undefined && <Text>{label}</Text>}
	</label>;
}

export function useTimeUntil(until: number | null) {
	const [time, setTime] = useState<null | number>(null);
	useEffect(() => {
		if (until == null) {
			setTime(null);
			return;
		}

		let curTimeout: number | null = null;
		const untilNext = () => {
			const nxt = 1001-(Date.now()%1000); // should be strictly in the next second... 1ms delay
			setTime(Math.floor((until-Date.now())/1000));
			curTimeout = setTimeout(untilNext, nxt);
		};

		untilNext();
		return () => {
			if (curTimeout != null) clearTimeout(curTimeout);
		};
	}, [until]);
	return time;
}

export function Countdown({ time, inline }: { time: number | null; inline?: boolean }) {
	if (time == null || time < 0) return [];
	const day = Math.floor(time/(3600*24)),
		hr = Math.floor(time/3600)%24,
		min = Math.floor(time/60)%60,
		sec = time%60;
	const d = [[day, "Day"], [hr, "Hour"], [min, "Minute"], [sec, "Second"]] satisfies [
		number,
		string,
	][];
	if (inline == true) {
		let f = false;
		return d.map(v => {
			if (v[0] == 0 && !f) return "";
			let a = v[0].toString();
			if (f) a = `:${a.padStart(2, "0")}`;
			f = true;
			return a;
		}).join("");
	}
	return <div className="flex flex-row gap-2 justify-evenly max-w-xs self-center">
		{d.map(([qty, name], i) =>
			<div className="flex flex-col gap-1 items-center justify-between" key={name}>
				<div className={twJoin(chipColors[chipColorKeys[i]], "p-2 px-3 rounded-md shadow-md")}>
					<Text v="md">{qty < 10 ? `0${qty}` : qty}</Text>
				</div>
				<Text v="sm">{name}{qty != 1 ? "s" : ""}</Text>
			</div>
		)}
	</div>;
}

export function FileInput(
	{ onUpload, maxSize, mimeTypes, children, ...props }: {
		onUpload: (x: File) => void;
		maxSize?: number;
		mimeTypes?: readonly string[];
	} & ButtonProps,
) {
	const [err, setErr] = useState<string | null>(null);
	const [errOpen, setErrOpen] = useState<boolean>(false);
	const id = useId();
	const ref = useRef<HTMLInputElement>(null);
	return <div className="flex flex-col gap-1 items-stretch">
		<label htmlFor={id}>
			<Button type="button" {...props} onClick={() => {
				ref.current!.click();
			}}>
				{children ?? "Choose file"}
			</Button>
		</label>
		<input id={id} ref={ref} accept={mimeTypes?.join(",")} type="file" className="sr-only"
			onInput={ev => {
				let err: string | null = null;
				if (ev.currentTarget.files && ev.currentTarget.files.length > 0) {
					const file = ev.currentTarget.files?.[0];
					if (maxSize != undefined && file.size > maxSize) {
						err = `File is > ${Math.floor(maxSize/1024)} KB, please choose something smaller`;
					} else if (mimeTypes != undefined && !mimeTypes.includes(file.type)) {
						err = `File should be ${mimeTypes.join(" or ")}, not ${file.type}.`;
					} else {
						onUpload(file);
					}
				}

				if (err == null) {
					setErr(null);
					ev.currentTarget.setCustomValidity("");
				} else {
					setErr(err);
					setErrOpen(true);
					ev.currentTarget.setCustomValidity(err);
				}
			}} />
		{err != null
			&& <Modal bad title="Invalid file" open={errOpen} onClose={() => setErrOpen(false)}>
				{err}
			</Modal>}
	</div>;
}
