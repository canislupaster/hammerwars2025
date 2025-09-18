import { IconChevronRight } from "@tabler/icons-preact";
import { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { fill } from "../../shared/util";
import { Footer } from "./main";
import { bgColor, Button, ease, Text, useGoto, useMd } from "./ui";

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
					activePats.push({
						pat: pats[4],
						y: Math.floor(Math.random()*(ny+2)-2),
						x: -2,
						nextStep: sec,
					});
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
			frame = requestAnimationFrame(t => layout(t));
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
					HAMMERWARS<span className="font-black anim-delay animate-fade-in">2025</span>
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
						"z-50 rounded-none border-4",
						md ? "text-3xl p-5 pr-1" : "text-xl p-3 pr-0 py-1",
					)}
					onClick={() => goto("/register")}
					iconRight={<IconChevronRight size={48} />}>
					Register now
				</Button>
				<Text v="normal" className="drop-shadow-xl/80 z-20">Closes October 24th!</Text>
			</div>
		</div>
		<div className="absolute left-0 right-0 top-0 bottom-0 from-zinc-900 to-transparent bg-gradient-to-r z-10" />
		<div className="absolute left-0 right-0 top-0 bottom-0 overflow-hidden" ref={container} />
	</div>;
}

export function Home() {
	const sponsorImageCls = "w-xs hover:scale-110 transition-all duration-300";
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
				Prizes will only be given to in-person participants as financial aid at an academic
				institution. Each prize is{" "}
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

		<div className={sectionStyle(true)}>
			{squared(<Text v="big">Sponsors</Text>)}
			<div className="flex flex-row justify-center mt-10 w-full">
				<a href="https://hudsonrivertrading.com/">
					<img src="/hrt-small.svg"
						className={twJoin(
							sponsorImageCls,
							"drop-shadow-2xl drop-shadow-black hover:drop-shadow-[#FF8200]/50",
						)} />
				</a>
			</div>
		</div>

		<div className={sectionStyle(false)}>{squared(<Text v="big">Schedule (tentative)</Text>)}</div>

		<div className={sectionStyle(true)}>{squared(<Text v="big">A HammerWars history</Text>)}</div>

		<Footer />
	</>;
}
