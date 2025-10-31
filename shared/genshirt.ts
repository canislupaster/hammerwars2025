import { Queue } from "./queue";
import { fill } from "./util";

type V2 = [number, number];
const det = (a: V2, b: V2) => a[0]*b[1]-a[1]*b[0];
const dot = (a: V2, b: V2) => a[0]*b[0]+a[1]*b[1];
const sub = (a: V2, b: V2): V2 => [a[0]-b[0], a[1]-b[1]];
const add = (a: V2, b: V2): V2 => [a[0]+b[0], a[1]+b[1]];
const mul = (a: V2, c: number): V2 => [a[0]*c, a[1]*c];

const EPS = 0.1;

const _intersect = (a: V2, b: V2, c: V2, d: V2) => {
	b = sub(b, a);
	c = sub(c, a);
	d = sub(d, a);

	let d1 = det(b, c), d2 = det(b, d);
	const x = dot(c, b), y = dot(d, b), r = dot(b, b);

	if (Math.abs(d1) < EPS && Math.abs(d2) < EPS && Math.min(x, y) > -EPS && Math.max(x, y) > r-EPS) {
		return "colinear" as const;
	}

	let l = dot(c, b)*d2-dot(d, b)*d1;
	if (d1 > d2) {
		[d1, d2, c, d] = [d2, d1, d, c];
		l *= -1;
	}

	return d1 < EPS && d2 > -EPS && l > -EPS && l < (d2-d1)*dot(b, b)+EPS;
};

const polarSort = (pts: V2[]) =>
	pts.sort((a, b) => {
		const ay = Math.sign(a[1]), by = Math.sign(b[1]);
		return (ay == by || ay == 0 || by == 0) ? -det(a, b) : by-ay;
	});

const _cut = (pts: V2[], a: V2, b: V2) => {
	polarSort(pts);
	let f = false;
	const out = [];
	const r = sub(b, a);
	for (let i = 0;; i = (i+1)%pts.length) {
		const u = pts[i], v = pts[(i+1)%pts.length];
		const d1 = det(sub(u, a), r);
		const d2 = det(sub(v, u), r);
		const pt = mul(add(mul(u, -d1), mul(v, d2)), 1/(0.001+Math.abs(d2-d1)));
		if (!f && d1 >= 0 && d2 <= 0) {
			out.push(pt);
			f = true;
		} else if (f && d1 <= 0 && d2 >= 0) {
			out.push(pt);
			break;
		} else if (f) {
			out.push(u);
		}
	}
	return out;
};

// https://github.com/bryc/code/blob/master/jshash/PRNGs.md
export class RNG {
	constructor(private a: number = Date.now()+Math.random()) {}
	// splitmix32
	next() {
		this.a |= 0;
		this.a = this.a+0x9e3779b9|0;
		let t = this.a^this.a>>>16;
		t = Math.imul(t, 0x21f0aaad);
		t = t^t>>>15;
		t = Math.imul(t, 0x735a2d97);
		return (t = t^t>>>15)>>>0;
	}
	nextFloat() {
		return this.next()/Math.pow(2, 32);
	}
	nextRange(min: number, max: number) {
		return min+(this.next()%(max-min+1));
	}
	nextString(chars: string[], len: number) {
		return fill(len, () => chars[this.nextRange(0, chars.length-1)]).join("");
	}
	shuffle<T>(s: readonly T[]): T[] {
		const ns = [...s];
		for (let i = s.length-1; i >= 0; --i) {
			const ri = this.nextRange(0, i);
			[ns[i], ns[ri]] = [ns[ri], ns[i]];
		}
		return ns;
	}
}

type V3 = [number, number, number];
type Cube = { pos: V3; l: number };

const add3 = ([a, b, c]: V3, [u, v, w]: V3): V3 => [a+u, b+v, c+w];
const _dot3 = ([a, b, c]: V3, [u, v, w]: V3): number => a*u+b*v+c*w;
const add3s = ([a, b, c]: V3, s: number): V3 => [a+s, b+s, c+s];
const mul3 = ([a, b, c]: V3, s: number): V3 => [a*s, b*s, c*s];
const rot = (v: V3, ax: number, rad: number) => {
	const [i, j] = [[1, 2], [0, 2], [0, 1]][ax];
	const c = Math.cos(rad), s = Math.sin(rad);
	const nv = [...v] as V3;
	nv[i] = c*v[i]-s*v[j];
	nv[j] = s*v[i]+c*v[j];
	return nv;
};

const numCubes = 400;
const deleteCubes = 0;

function filter(
	pos: V2,
	dim: V2,
	ctx: OffscreenCanvasRenderingContext2D,
	x: (f: (i: number, j: number) => Uint8ClampedArray) => void,
) {
	const data = ctx.getImageData(pos[0], pos[1], dim[0], dim[1]);
	x((i: number, j: number) => {
		const idx = (i*dim[0]+j)*4;
		return data.data.subarray(idx, idx+4);
	});
	ctx.putImageData(data, pos[0], pos[1]);
}

function drawCubes(rng: RNG, ctx: OffscreenCanvasRenderingContext2D, pos: number[], dim: number[]) {
	const shrink = 0.7, shrinkMax = 0.03, backGap = 0.04;

	const cubes = new Queue<Cube>((a, b) => a.l > b.l);
	cubes.push({ pos: add3s([-0.5, -0.5, -0.5], -shrinkMax/2), l: 1+shrinkMax-backGap });
	while (cubes.size() < numCubes) {
		const { pos, l } = cubes.pop();
		const newCubes = [];
		const rat = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3][rng.nextRange(0, 9)];
		const x = l/(rat+1);
		newCubes.push({ pos, l: x });
		newCubes.push({ pos: add3s(pos, x), l: l-x });
		for (let i = 0; i < rat; i++) {
			for (let j = 0; j < 3; j++) {
				const dir = fill(3, d => d == j ? x : 0) as V3;
				newCubes.push({ pos: add3(pos, mul3(dir, i+1)), l: x });
			}
		}
		for (let i = 0; i < rat; i++) {
			for (let j = 0; j < rat; j++) {
				for (let r = 0; r < 3; r++) {
					const [a, b] = [[1, 2], [0, 2], [0, 1]][r];
					const dir1 = fill(3, d => d == a ? x : 0) as V3;
					const dir2 = fill(3, d => d == b ? x : 0) as V3;
					newCubes.push({ pos: add3(add3(pos, mul3(dir1, i+1)), mul3(dir2, j+1)), l: x });
				}
			}
		}

		const flip = fill(3, () => rng.nextRange(0, 1) == 0);
		const oldCent = add3s(pos, l/2);
		for (const cube of newCubes) {
			const rel = add3(add3s(cube.pos, cube.l/2), mul3(oldCent, -1));
			for (let i = 0; i < 3; i++) if (flip[i]) rel[i] *= -1;
			cube.pos = add3s(add3(rel, oldCent), -cube.l/2);
			cubes.push(cube);
		}
	}

	const rects: { pts: V3[]; dir: V3; flip: boolean; l: number }[] = [];

	let cubeArray: Cube[] = [];
	while (cubes.size() > 0) cubeArray.push(cubes.pop());
	rng.shuffle(cubeArray);
	cubeArray = cubeArray.slice(0, cubeArray.length-deleteCubes);

	for (const cube of cubeArray) {
		const cent = add3s(cube.pos, cube.l/2);
		cube.l = Math.max(cube.l*shrink, cube.l-shrinkMax);
		for (let i = 0; i < 6; i++) {
			const dir = fill(3, j => i%3 == j ? i >= 3 ? -1 : 1 : 0) as V3;
			const [a, b] = [[1, 2], [0, 2], [0, 1]][i%3];
			const dir1 = fill(3, d => d == a ? cube.l/2 : 0) as V3;
			const dir2 = fill(3, d => d == b ? cube.l/2 : 0) as V3;
			const t = add3(cent, mul3(dir, cube.l/2));
			const rect = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([u, v]) =>
				add3(t, add3(mul3(dir1, u), mul3(dir2, v)))
			);
			rects.push({ pts: rect, dir, flip: rng.nextRange(0, 1) == 0, l: cube.l });
		}
	}

	const t = 1;
	const orbitUp = (t*18+6*(rng.nextFloat()-0.5))/360*Math.PI;
	const orbitRight = (t*60+6*(rng.nextFloat()-0.5))/360*Math.PI;
	const persp = 0.00;
	const calcP = (x: number) => 0.95/(1+persp*x);
	const transform = (pt: V3): V3 => {
		pt = rot(rot(pt, 1, orbitRight), 0, orbitUp);
		pt[2] += 5;
		const sc = calcP(pt[2]);
		return [sc*pt[0]+dim[0]/2+pos[0], sc*pt[1]+dim[1]/2+pos[1], pt[2]];
	};

	const minLineWidth = 8;
	const nrects = rects.map(({ pts, ...r }) => ({ pts: pts.map(transform), ...r })).map(r => {
		const avg = mul3(r.pts.reduce((a, b) => add3(a, b), [0, 0, 0]), 1/r.pts.length);
		return { ...r, avg, w: 50*Math.pow(r.l, 0.45)/(1+0.07*avg[2]) };
	}).filter(({ w }) => w > minLineWidth);

	const ptsPath = (coords: number[][]) => {
		ctx.beginPath();
		ctx.moveTo(coords[0][0], coords[0][1]);
		coords.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
		ctx.closePath();
	};

	const sc = 1, sc2 = 1;
	const nlines = 11, gridSc = 1.1;
	const zero: V3 = [0, 0, 0];
	const hull = (pts: number[][]) => {
		const out: number[][] = [];
		pts.sort((a, b) => a[0]-b[0]);
		for (let side = 0; side <= 1; side++) {
			if (side) pts.reverse();
			for (const pt of pts) {
				while (out.length >= 2) {
					const a = out[out.length-2], b = out[out.length-1];
					if ((pt[0]-a[0])*(b[1]-a[1])-(pt[1]-a[1])*(b[0]-a[0]) < 0) break;
					out.pop();
				}
				out.push(pt);
			}
		}
		return out;
	};

	const boundaryPts: V3[] = [];
	const faces = fill(6, i => {
		const dir = fill(3, j => i%3 == j ? i >= 3 ? -1 : 1 : 0) as V3;
		const [a, b] = [[1, 2], [0, 2], [0, 1]][i%3];
		const dir1 = fill(3, d => d == a ? 1/2 : 0) as V3;
		const dir2 = fill(3, d => d == b ? 1/2 : 0) as V3;
		const cent = mul3(dir, 1/2);
		const face = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([u, v]) =>
			add3(cent, add3(mul3(dir1, u), mul3(dir2, v)))
		).map(a => mul3(a, sc2)).map(transform);
		if (i < 3) boundaryPts.push(...face);
		return face;
	});

	const boundaryHull = hull(boundaryPts);
	const bbox = fill(
		2,
		i => fill(2, j => (i == 0 ? Math.min : Math.max)(...boundaryPts.map(v => v[j]))),
	);

	ctx.save();
	const scale = Math.min(dim[0]/(bbox[1][0]-bbox[0][0]), dim[1]/(bbox[1][1]-bbox[0][1]));
	ctx.translate(
		pos[0]+dim[0]/2-scale*(bbox[0][0]+bbox[1][0])/2,
		pos[1]+dim[1]/2-scale*(bbox[0][1]+bbox[1][1])/2,
	);
	ctx.scale(scale, scale);

	const setWidth = (l: number) => {
		l = Math.round(l);
		ctx.lineWidth = l < minLineWidth ? 0 : l/scale;
	};

	const gridLine = (from: V3, to: V3, w: number, col: string) => {
		ctx.beginPath();

		from = mul3(from, -1);
		to = mul3(to, -1);
		from = transform(from);
		to = transform(to);
		ctx.moveTo(from[0], from[1]);
		ctx.lineTo(to[0], to[1]);

		ctx.strokeStyle = col;
		setWidth(80*w);
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.stroke();
	};

	const drawGrid = () => {
		for (let ax = 0; ax < 3; ax++) {
			const xd: V3 = add3s(zero, -0.5);
			const dir = fill(3, d => d == ax ? gridSc : 0) as V3;
			gridLine(xd, add3(dir, xd), 0.6, "white");
			for (let odir = 0; odir < 3; odir++) {
				if (odir != ax) {
					const mul = ax != 1 && odir != 1 ? 0.4 : (odir == 1 ? 0.7 : 1);
					const od = fill(3, d => d == odir ? gridSc : 0) as V3;
					for (let i = 1; i < nlines; i++) {
						const base = add3(xd, mul3(od, i/nlines));
						gridLine(base, add3(base, dir), mul*(0.2+0.5/(1+i)), "#FB9AAB");
					}
				}
			}
		}
	};

	for (let i = 3; i < 6; i++) {
		const face = faces[i];
		ptsPath(face);
		const g = ctx.createLinearGradient(face[1][0], face[1][1], face[3][0], face[3][1]);
		g.addColorStop(0, "#290505ff");
		g.addColorStop(1, "#000000ff");
		ctx.fillStyle = g;
		if (i == 3) {
			ctx.fill();
			ctx.save();
			ctx.clip();
			drawGrid();
			ctx.restore();
		}
	}

	nrects.sort((a, b) => b.avg[2]-a.avg[2]);
	for (const r of nrects) {
		ptsPath(r.pts);

		ctx.globalCompositeOperation = "source-atop";
		ctx.fillStyle = "rgba(0,0,0,0.3)";
		ctx.fill();
		ctx.globalCompositeOperation = "source-over";

		setWidth(r.w);
		ctx.strokeStyle = "white";

		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		ctx.stroke();
	}

	ctx.save();
	ptsPath(boundaryHull);
	ctx.clip();

	for (let i = 3; i < 6; i++) {
		const dir = fill(3, j => i%3 == j ? i >= 3 ? -1 : 1 : 0) as V3;
		const [a, b] = [[1, 2], [0, 2], [0, 1]][i%3];
		const dir1 = fill(3, d => d == a ? 1/2 : 0) as V3;
		const dir2 = fill(3, d => d == b ? 1/2 : 0) as V3;
		const cent = mul3(dir, 1/2);
		const rect = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(d => d.map(v => v < 0 ? v : 2*v)).map((
			[u, v],
		) => add3(cent, add3(mul3(dir1, u), mul3(dir2, v)))).map(a => mul3(a, sc)).map(transform);

		if (i == 3) {
			ctx.save();
			ctx.globalCompositeOperation = "difference";
			ptsPath(rect);
			ctx.fillStyle = "white";
			ctx.fill();
			ctx.restore();
		}

		ptsPath(rect);

		const [gradStart, gradEnd] = [-1, 1].map(v => transform(add3(cent, mul3(dir1, v))));
		const baseHex = ["#7affd9", "#8fecff", "#b3fffc"][i%3];
		if (i == 3) {
			const grad = ctx.createLinearGradient(gradStart[0], gradStart[1], gradEnd[0], gradEnd[1]);
			grad.addColorStop(0, `${baseHex}00`);
			grad.addColorStop(1, `${baseHex}aa`);
			ctx.fillStyle = grad;
		} else {
			ctx.fillStyle = `${baseHex}aa`;
		}
		ctx.globalCompositeOperation = "color";
		ctx.fill();

		ctx.fillStyle = i == 3 ? "#242424ff" : "#ffffffff";
		ctx.globalCompositeOperation = "overlay";
		ctx.fill();

		ctx.globalCompositeOperation = "source-over";
		ctx.strokeStyle = "white";
		setWidth(30);
		ctx.stroke();
	}

	ctx.restore();

	ptsPath(boundaryHull);
	ctx.strokeStyle = "white";
	setWidth(30);
	ctx.stroke();
	ctx.restore();
}

// color conversions by Kamil Kiełczewski
function rgb2hsv([r, g, b]: Readonly<V3>): V3 {
	const v: number = Math.max(r, g, b), c: number = v-Math.min(r, g, b);
	const h: number = c && ((v == r) ? (g-b)/c : ((v == g) ? 2+(b-r)/c : 4+(r-g)/c));
	return [60*(h < 0 ? h+6 : h), v && c/v, v];
}

function hsv2rgb([h, s, v]: Readonly<V3>): V3 {
	const f = (n: number, k = (n+h/60)%6) => v-v*s*Math.max(Math.min(k, 4-k, 1), 0);
	return [f(5), f(3), f(1)];
}

export const shirtFontFamily = "IBM Plex Sans";
export async function makeShirt(
	{ team, name, seed, canvasConstructor, assets, quality, hue, organizer }: {
		team: string;
		name: string;
		hue: number;
		quality: "low" | "high";
		canvasConstructor: (w: number, h: number) => OffscreenCanvas;
		assets: { base: CanvasImageSource; bracket: CanvasImageSource; logo?: CanvasImageSource };
		seed: number;
		organizer?: boolean;
	},
) {
	const downScale = quality == "low" ? 8 : 1;
	const totalW = 6900, totalH = 8284;
	const realW = Math.round(totalW/downScale), realH = Math.round(totalH/downScale);
	const canvas = canvasConstructor(realW, realH);
	const ctx = canvas.getContext("2d", {
		willReadFrequently: true,
		imageSmoothingEnabled: false,
		antialias: false,
	})!;

	ctx.scale(realW/totalW, realH/totalH);
	ctx.drawImage(assets.base, 0, 0);

	const off = [613, 1330+(organizer == true ? 1637-1352 : 30)], dim = [6276, 5181];
	const off2 = off.map(v => Math.max(0, v));
	const dim2 = fill(2, i => Math.min(off[i]+dim[i], [totalW, totalH][i])-off2[i]);

	const rng = new RNG(seed);

	drawCubes(rng, ctx, off2, dim2);

	const minTextSize = 100;
	const condense = 4;
	const textBox = (txt: string, w: number, maxH: number, pos: V2, weight: number) => {
		ctx.letterSpacing = `-${condense}px`;
		ctx.font = `${weight} ${minTextSize}px "${shirtFontFamily}"`;
		const w2 = ctx.measureText(txt);
		if (w2.width == 0 || w2.actualBoundingBoxAscent == 0) return 0;
		const mult = Math.max(1, Math.min(w/w2.width, maxH/w2.actualBoundingBoxAscent));
		ctx.font = `${weight} ${minTextSize*mult}px "${shirtFontFamily}"`;
		ctx.fillStyle = "white";
		ctx.letterSpacing = `-${mult*condense}px`;
		ctx.fillText(txt, pos[0], pos[1]-(maxH-w2.actualBoundingBoxAscent*mult)/2);
		ctx.letterSpacing = "0px";
		return pos[0]+mult*w2.width;
	};

	const textW = assets.logo ? 4085.9 : 5042.9;
	const w1 = textBox(team, textW+986.9, 365.7, [1600.1-986.9, 7608.5], 900);
	const w2 = textBox(name, textW+819.5, 338.9, [1600.1-819.5, 8152.5], 600);
	const hOverW = 1758/1607;
	const left = Math.min(totalW-Math.max(w1, w2)-195, 1694/hOverW);

	hue += 352;
	filter([0, 0], [realW, realH], ctx, old => {
		for (let i = 0; i < realH; i++) {
			for (let j = 0; j < realW; j++) {
				const px = old(i, j);
				const hsv = rgb2hsv([...px.slice(0, -1)] as V3);
				hsv[0] = (hsv[0]+hue)%360;
				px.set([...hsv2rgb(hsv), px[3]]);
			}
		}
	});

	if (assets.logo) {
		const pad = (1-1492.2/1647.1)*left;
		const h = hOverW*left;
		ctx.drawImage(assets.bracket, totalW-left, totalH-h, left, h);
		ctx.drawImage(assets.logo, totalW-left, totalH-h+pad, left-pad, left-pad);
	}

	const threshold = 60;
	if (quality == "high") {
		filter([0, 0], [realW, realH], ctx, old => {
			for (let i = 0; i < realH; i++) {
				for (let j = 0; j < realW; j++) {
					const v = old(i, j);
					if (rgb2hsv([...v] as V3)[2] < threshold) {
						old(i, j).set([0, 0, 0, 0]);
					}
				}
			}
		});
	}

	return canvas;
}

export const maxShirtSeed = Number((1n<<31n)-1n);
export const randomShirtSeed = () => Math.round(Math.random()*maxShirtSeed);
