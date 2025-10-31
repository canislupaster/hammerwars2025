import { IconCalendar, IconChevronRight } from "@tabler/icons-preact";
import { ComponentChildren } from "preact";
import { lazy } from "preact-iso";
import { useEffect, useRef, useState } from "preact/hooks";
import { twJoin, twMerge } from "tailwind-merge";
import { fill, Scoreboard, timePlace } from "../../shared/util";
import { useFeed, useRequest } from "./clientutil";
import { Footer } from "./main";
import { Anchor, bgColor, Button, Card, Collapse, ease, Text, textColor, useGoto, useLg,
	useMd } from "./ui";

const squared = (x: ComponentChildren) =>
	<div className="flex flex-row md:gap-4 gap-2 items-start relative">
		<div className="w-8 aspect-square bg-neutral-400 mb-1 shrink-0" />
		<div className="absolute my-auto left-10 w-8 top-0 aspect-square bg-neutral-400/30 mb-1" />
		<div className="absolute my-auto left-20 w-8 top-0 aspect-square bg-neutral-400/10 mb-1" />
		<div className="z-10">{x}</div>
	</div>;

function Section(
	{ children, inv, className }: { children: ComponentChildren; inv?: boolean; className?: string },
) {
	return <div
		className={twMerge(
			"flex flex-col gap-2 items-start md:px-[20vw] px-5 w-full py-10 relative overflow-clip",
			className,
		)}>
		{children}
		{inv == true
			&& <div className={twJoin("absolute w-full h-full top-0 left-0 -z-20", bgColor.secondary)} />}
	</div>;
}

type ScheduleItem = { time: string; title: string; note: string };

const scheduleItems: ScheduleItem[] = [
	{
		time: "10:00 AM - 11:00 AM",
		title: "Check-in",
		note: "Confirm your team roster, grab your shirt and settle in before the welcome kicks off.",
	},
	{
		time: "11:00 AM - 11:40 AM",
		title: "Opening ceremony",
		note: "Meet our sponsors and watch a brief tutorial.",
	},
	{
		time: "11:40 AM - 12:40 PM",
		title: "Practice round and setup",
		note:
			"You'll have an hour to solve practice problems and setup your workstation for the real thing.",
	},
	{ time: "12:40 PM - 1:25 PM", title: "Lunch", note: "Subway sandwich of your choice." },
	{
		time: "1:30 PM - 6:30 PM",
		title: "Main contest",
		note: "The real contest and its online mirror take place.",
	},
	{
		time: "6:35 PM - 7:30 PM",
		title: "Pizza, awards, and closing ceremony",
		note: "The scoreboard is resolved, winners are announced and solutions are released.",
	},
];

type FAQItem = { question: string; answer: ComponentChildren };

const faqItems: FAQItem[] = [{
	question: "Can we join remotely?",
	answer: "Yes! Online teams may compete on DOMJudge.",
}, {
	question: "What do I need to bring?",
	answer:
		"Please bring scratch paper and writing utensils. You don't need a device; the contest will be held on lab computers.",
}, {
	question: "When/where is the event?",
	answer:
		`It will be held ${timePlace}. The opening ceremony will be in LWSN 1142, the contest in the Lawson labs, and the closing in the Commons.`,
}, {
	question: "What languages are supported?",
	answer:
		"C++, Python (PyPy 3), Java, Kotlin, Javascript, Typescript, Rust and Zig are all supported by our judgehosts.",
}, {
	question: "Will there be food?",
	answer:
		"Coffee and donuts will be served in the morning, followed by lunch between the practice and official contest. We close out the night with pizza.",
}];

function FAQ({ items }: { items: FAQItem[] }) {
	return <div className="w-full flex flex-col gap-3">
		{items.map((item, index) => {
			return <Card key={index} className="flex flex-col">
				<Text v="md">{item.question}</Text>
				<Text v="sm" className={twJoin("leading-relaxed", textColor.gray)}>{item.answer}</Text>
			</Card>;
		})}
	</div>;
}

type PatternArgs = {
	dt: number;
	nx: number;
	ny: number;
	sec: number;
	flipped: boolean[][];
	flippedFrom: ([number, number] | null)[][];
};

abstract class Pattern {
	abstract startProb: number;
	abstract update(args: PatternArgs): void;
}

class Pattern1 extends Pattern {
	newPatProb = 0.2;
	r = -Math.log(1-this.newPatProb);
	delay = 0.2;

	startProb = 0.5;
	pats = ["000111000", "010111010", "101010101", "010010010", "100010001", "001010100"].map(p =>
		fill(3, i => fill(3, j => p[i*3+j] == "1"))
	);
	activePats: { pat: boolean[][]; y: number; x: number; nextStep: number }[] = [];

	update({ dt, nx, ny, sec, flipped }: PatternArgs) {
		if (Math.random() > Math.exp(-this.r*dt) || this.activePats.length == 0) {
			this.activePats.push({
				pat: this.pats[4],
				y: Math.floor(Math.random()*(ny+2)-2),
				x: -2,
				nextStep: sec,
			});
		}

		this.activePats = this.activePats.filter(pat => {
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
			pat.nextStep += this.delay;
			return pat.x < nx;
		});
	}
}

export class Pattern2 extends Pattern {
	r = -Math.log(1-0.5);
	delay = 0.6;
	lastStep = 0;
	flipDur = 10;

	startProb = 0.0;
	update({ dt, nx, ny, sec, flipped, flippedFrom }: PatternArgs) {
		const dirI = sec%(4*this.flipDur) > 2*this.flipDur ? -1 : 1;
		const dirJ = sec%(2*this.flipDur) > this.flipDur ? -1 : 1;
		if (Math.random() > Math.exp(-this.r*dt)) {
			let u: number, v: number;
			if (Math.random() > 0.5) {
				u = dirI == 1 ? ny-1 : 0;
				v = Math.floor(Math.random()*nx);
			} else {
				u = Math.floor(Math.random()*ny);
				v = dirJ == 1 ? nx-1 : 0;
			}
			flipped[u][v] = true;
		}
		if (sec >= this.lastStep+this.delay) {
			this.lastStep = sec;
			const oflipped = fill(ny, i => fill(nx, j => flipped[i][j]));
			const g = (i: number, j: number) =>
				i < 0 || i >= ny || j < 0 || j >= nx ? true : oflipped[i][j];
			for (let i = 0; i < ny; i++) {
				for (let j = 0; j < nx; j++) {
					const s = (i2: number, j2: number, v: boolean) => {
						if (i2 < 0 || i2 >= ny || j2 < 0 || j2 >= nx) return false;
						if (v && !flipped[i2][j2]) flippedFrom[i2][j2] = [i, j];
						flipped[i2][j2] = v;
						return true;
					};
					if (oflipped[i][j]) {
						let mayDel = true;
						let f = false;
						const a = g(i+dirI, j);
						const b = g(i, j+dirJ);
						f ||= a || b;
						if (a && b) s(i-dirI, j-dirJ, true);
						if (a) {
							s(i+dirI, j, false);
							if (s(i-dirI, j, true)) mayDel = false;
						} else if (b) {
							s(i, j+dirJ, false);
							if (s(i, j-dirJ, true)) mayDel = false;
						}
						if (!f || (mayDel && Math.random() < 0.0)) s(i, j, false);
					}
				}
			}
		}
	}
}

export class Pattern3 extends Pattern {
	startProb = 0;
	#r = -Math.log(1-0.4);
	#nextUp = -1;
	#start = true;
	update({ dt, nx, ny, sec, flipped }: PatternArgs) {
		if (Math.random() > Math.exp(-this.#r*dt) || this.#start) {
			this.#start = false;
			flipped[Math.floor(Math.random()*ny)][0] = true;
		}
		if (sec > this.#nextUp) {
			this.#nextUp = sec+1+Math.random()*2;
			const neighbor = [[-1, 0], [1, 0], [0, 1], [0, -1], [0, 0]];
			let curCost = Infinity;
			let cur: [number, number][] = [];
			for (let i = 0; i < ny; i++) {
				for (let j = 0; j < nx; j++) {
					if (flipped[i][j]) {
						let c = 0;
						for (const [di, dj] of neighbor) {
							c += i+di >= 0 && i+di < ny && j+dj >= 0 && j+dj <= nx
								? (flipped[i+di][j+dj] ? -1 : 1)
								: 0;
						}
						if (c < curCost) {
							cur = [[i, j]];
							curCost = c;
						} else if (c == curCost) cur.push([i, j]);
					}
				}
			}
			const nops = Math.ceil(Math.random()*5);
			for (let i = 1; i < cur.length; i++) {
				const j = Math.floor(Math.random()*(i+1));
				[cur[i], cur[j]] = [cur[j], cur[i]];
			}
			const short = cur.slice(0, nops);
			for (const [i, j] of short) {
				for (const [di, dj] of neighbor) {
					if (i+di >= 0 && i+di < ny && j+dj >= 0 && j+dj <= nx) {
						flipped[i+di][j+dj] = !flipped[i+di][j+dj];
					}
				}
			}
		}
	}
}

export function PatternBg(
	{ velocity, uniformVelocity, pat, grad, opacity, flipAnim }: {
		velocity?: number;
		uniformVelocity?: boolean;
		pat: () => Pattern;
		grad?: boolean;
		opacity?: number;
		flipAnim?: boolean;
	},
) {
	const container = useRef<HTMLDivElement>(null);
	const patInst = useRef<Pattern | null>(null);

	useEffect(() => {
		if (patInst.current == null) {
			patInst.current = pat();
		}
	}, [pat]);

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
			const speeds = fill(
				2,
				fill(ny, () => (velocity ?? 1)*(uniformVelocity == true ? 0.2 : Math.random()/5+0.1)),
			);
			let last = performance.now()/1000;
			const shiftOff = fill(2, i => fill(ny, j => Math.floor(last*speeds[i][j])));

			const brightness = fill(ny, () => fill(nx, () => 0));
			const offset = fill(ny, () => fill(nx, () => [0, 0]));
			const flipped = fill(ny, () => fill(nx, () => Math.random() < patInst.current!.startProb));

			const w = el.clientWidth;
			const yOff = (ny*sz-el.clientHeight)/2;
			const layout = (t: number) => {
				const sec = t/1000;
				const dt = sec-last;
				if (dt > .5) return reset();

				const flippedFrom: PatternArgs["flippedFrom"] = fill(ny, () => fill(nx, () => null));
				patInst.current!.update({ dt, sec, ny, nx, flipped, flippedFrom });
				for (let j = 0; j < ny; j++) {
					for (let i = 0; i < nx; i++) {
						const v = flippedFrom[j][i];
						if (v != null && brightness[j][i] < 0.1) {
							offset[j][i] = [v[0]+offset[v[0]][v[1]][0]-j, v[1]+offset[v[0]][v[1]][1]-i];
						}
					}
				}
				last = sec;

				const coeff = Math.exp(-dt*3);
				const moveCoeff = Math.exp(-dt*6);
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
						off += sz*(l == 1 && uniformVelocity != true ? ease(shift%1) : shift%1);
					}

					for (let i = 0; i < nx; i++) {
						const l = (i+offset[j][i][1])*sz+off;
						nodes[j][i].style.left = `${l}px`;
						nodes[j][i].style.top = `${(j+offset[j][i][0])*sz-yOff}px`;
						const target = flipped[j][i] ? (opacity ?? 1) : 0;
						brightness[j][i] = coeff*brightness[j][i]+(1-coeff)*target;
						offset[j][i] = [moveCoeff*offset[j][i][0], moveCoeff*offset[j][i][1]];
						const close = !offset[j][i].some(x => Math.abs(x) > 0.2);
						nodes[j][i].style.zIndex = close ? "0" : "-1";
						const b = brightness[j][i]*(grad == true ? l/w : 1);
						if (flipAnim == true) {
							nodes[j][i].style.background = "white";
							nodes[j][i].style.transform = `perspective(200px) scale(${
								Math.max(0, b-0.2)*0.94
							}) rotateX(${
								(brightness[j][i] > target ? -1 : 1)*Math.min(1, 1.2-1.2*b)*90
							}deg) translateZ(50px)`;
						} else {
							nodes[j][i].style.background = close
								? `hsl(0 0 ${b*100}%)`
								: `rgba(255,255,255,${b})`;
						}
					}
				}

				frame = requestAnimationFrame(layout);
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
	}, [flipAnim, grad, opacity, uniformVelocity, velocity]);

	return <div
		className="absolute left-0 right-0 top-0 bottom-0 overflow-hidden mix-blend-screen -z-10"
		ref={container} />;
}

const LazyScoreboardStatus = lazy(() => import("./scoreboard").then(v => v.ScoreboardStatus));

function Status() {
	const [sc, setSc] = useState<Scoreboard>();
	useFeed("scoreboard", setSc);
	return <Collapse open={sc?.startTimeMs != undefined || sc?.endTimeMs != undefined}
		className="md:w-[80%] w-full px-10">
		<div className="flex flex-col lg:flex-row gap-2 items-center p-5 justify-center lg:justify-between w-full gap-y-3">
			<div className="flex flex-row gap-2 items-center">
				<span className="h-4 aspect-square rounded-full bg-red-500 animate-pulse" />
				<Text className="pt-0.5" v="md">Contest status</Text>
			</div>
			<LazyScoreboardStatus sc={sc} home />
		</div>
	</Collapse>;
}

function Hero({ registerOnly }: { registerOnly?: boolean }) {
	const goto = useGoto();
	const lg2 = useLg();
	const lg = lg2 || registerOnly == true;
	const window = useRequest({ route: "registrationWindow", initRequest: true });
	return <div className={twJoin("w-full relative")}>
		<div
			className={twJoin(
				"py-4",
				registerOnly == true ? "min-h-[20vh]" : "min-h-[30vh]",
				lg ? "z-50 flex flex-row px-10 items-center" : "flex flex-col gap-2 items-center",
				!lg || registerOnly == true ? "justify-center" : "justify-between",
			)}>
			{registerOnly != true
				&& <div className={twJoin("flex flex-col gap-4", lg ? "items-start" : "px-3 items-center")}>
					<h1 className="lg:text-6xl md:text-5xl sm:text-3xl text-2xl z-20 animate-fade-in">
						HAMMERWARS<span className="font-black anim-delay animate-fade-in">2025</span>
					</h1>
					<p className="z-20 sm:text-xl text-lg md:mt-0 -mt-2">
						The{" "}
						<span className="bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-400 text-transparent font-bold">
							Purdue
						</span>{" "}
						programming contest.
					</p>
					<p className="z-20 text-sm -mt-2 flex items-center gap-2">
						<span className="shrink-0">
							<IconCalendar />
						</span>{" "}
						{timePlace} (or online)
					</p>
				</div>}
			<div
				className={twJoin(
					"flex flex-col gap-2 pt-2 items-center",
					lg && registerOnly != true && "pr-20 pt-5",
				)}>
				<Button
					className={twJoin(
						"z-50 rounded-none border-4",
						lg ? "md:text-3xl text-2xl p-5 pr-1" : "text-xl p-3 pr-0 py-1",
					)}
					onClick={() => goto("/register")}
					iconRight={<IconChevronRight size={48} />}>
					Register now
				</Button>
				{window.current?.data.closes != null
					&& <Text v="normal" className="drop-shadow-xl/80 z-20">
						Closes{" "}
						{new Date(window.current.data.closes).toLocaleDateString("en-US", {
							day: "numeric",
							month: "long",
						})}!
					</Text>}
			</div>
		</div>
		<div className="absolute left-0 right-0 top-0 bottom-0 from-zinc-900 to-transparent bg-gradient-to-r z-10" />
		<PatternBg pat={() => new Pattern1()} grad />
	</div>;
}

export function Home() {
	const sponsorImageCls = "w-xs hover:scale-110 transition-all duration-300";
	const bullet = [
		/* eslint-disable react/jsx-key */
		<>
			<span className="text-xl font-big font-black">5</span> hours.
		</>,
		<>
			<span className="text-xl font-big font-black">12</span> problems.
		</>,
		<>
			<span className="text-xl font-big font-black -mr-2">3</span> -person teams.
		</>,
		"Held at Purdue University, with an online division.",
		/* eslint-enable react/jsx-key */
	];
	const md = useMd();
	return <>
		<Hero />

		<Status />

		<Section inv>
			{squared(<Text v="big">An ICPC-inspired contest</Text>)}
			<img src="/squares.svg" className="absolute opacity-50 h-[130%] -top-[20%] -right-10 -z-10" />
			<p className="mt-3">
				The <Anchor href="https://purduecpu.com">Competitive Programmers Union</Anchor>{" "}
				at Purdue University is thrilled to announce our annual programming contest, now with an
				online division.
			</p>
			<div className="mt-2 flex flex-col gap-1">
				{bullet.map((v, i) =>
					<div key={i} className="flex flex-row gap-2 items-baseline">
						<span className="bg-white h-5 aspect-square" style={{ opacity: 1-i/bullet.length }} />
						{v}
					</div>
				)}
			</div>
		</Section>

		<Section>
			{squared(<Text v="big">A beginner-friendly contest</Text>)}
			<img src="/creepysmile.svg"
				className="absolute opacity-5 h-[150%] -top-[10%] -right-10 -z-10" />
			<Text v="bold" className="my-5">
				HammerWars is for{" "}
				<span className="bg-clip-text bg-gradient-to-r from-zinc-200 to-zinc-100 text-transparent font-bold">
					everyone who can code.
				</span>
			</Text>
			<Text>
				We've created accessible versions of harder problems so everyone can enjoy the contest,{" "}
				<b>no matter their experience.</b>
			</Text>
			<Text className="mt-5 italic" v="sm">
				And for the exceptional, we doubt anyone can AK the contest, but we challenge you to try!
			</Text>
		</Section>

		<Section inv>
			<img src="/present.svg" className="absolute opacity-40 h-[110%] top-[10%] -left-10 -z-10" />
			{squared(<Text v="big">Free stuff</Text>)}
			<p>
				In-person contestants will receive <b>free shirts, lunch, dinner, coffee and snacks</b>.
			</p>
			<p>First solvers will also get plushies and there'll be trophies for the winners.</p>

			<img src="/prizes.webp" className="md:-mx-10 scale-110" />
		</Section>

		<Section>
			<img src="/heart.svg"
				className="absolute opacity-5 md:opacity-10 h-[120%] -top-[10%] -left-20 -z-10" />
			{squared(<Text v="big">Sponsors</Text>)}
			<Text>
				This event wouldn't be possible without these incredible companies who recognize the value
				of competitive programming!
			</Text>
			<div className="flex flex-row justify-center items-center mt-10 w-full flex-wrap gap-x-20 gap-y-10">
				<a href="https://hudsonrivertrading.com/">
					<img src="/hrt-small.svg"
						className={twJoin(
							sponsorImageCls,
							"drop-shadow-2xl drop-shadow-black hover:drop-shadow-[#FF8200]/50 max-w-xs max-h-[20vh]",
						)} />
				</a>
				<a href="https://www.roblox.com">
					<img src="/roblox-logo.svg"
						className={twJoin(
							sponsorImageCls,
							"drop-shadow-lg drop-shadow-black hover:drop-shadow-white/50 max-h-[10vh]",
						)} />
				</a>
			</div>
		</Section>

		<Section inv>
			{squared(<Text v="big">Event schedule</Text>)}
			<div className="w-full flex flex-col gap-4 mt-6">
				{scheduleItems.map((
					{ time, title, note },
				) => (<Card key={`${time}-${title}`} className="gap-2">
					<Text v="smbold" className={twJoin("uppercase tracking-wide", textColor.dim)}>
						{time}
					</Text>
					<Text v="md">{title}</Text>
					<Text v="sm" className="-mt-1">{note}</Text>
				</Card>))}
			</div>
		</Section>

		<Section>
			{squared(<Text v="big">FAQ</Text>)}
			<div className="w-full mt-6">
				<FAQ items={faqItems} />
			</div>
		</Section>

		<Section inv>
			{squared(<Text v="big">History of HammerWars</Text>)}
			<Text>
				This will be the <b>fourth</b>{" "}
				HammerWars! In the past, we've collaborated with Purdue Hackers to host an exhilarating
				contest for 100 participants with $2000 in prizes, free shirts, and more.{" "}
				<b>But this year will be even better.</b>
			</Text>
			<div className="flex flex-col md:flex-row justify-center gap-5 flex-wrap mt-8">
				{fill(3, i =>
					<img key={i} src={`/last/${i+1}.jpg`} className="max-w-full md:max-w-sm" style={!md
						? undefined
						: { transform: `rotateZ(${[2, -3, -2][i]}deg)`, scale: `${[110, 90, 100][i]}%` }} />)}
			</div>
			<Anchor href="https://events.purduehackers.com/events/special/hammerwars/2023"
				className="self-center mt-2">
				Purdue Hackers event recap
			</Anchor>
		</Section>

		<Hero registerOnly />
		<Footer />
	</>;
}
