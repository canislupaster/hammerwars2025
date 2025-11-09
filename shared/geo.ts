export type V2 = [number, number];
export const det = (a: V2, b: V2) => a[0]*b[1]-a[1]*b[0];
export const dot = (a: V2, b: V2) => a[0]*b[0]+a[1]*b[1];
export const sub = (a: V2, b: V2): V2 => [a[0]-b[0], a[1]-b[1]];
export const add = (a: V2, b: V2): V2 => [a[0]+b[0], a[1]+b[1]];
export const mul = (a: V2, c: number): V2 => [a[0]*c, a[1]*c];
export const norm = ([a, b]: V2): number => Math.hypot(a, b);

export type V3 = [number, number, number];
export const add3 = ([a, b, c]: V3, [u, v, w]: V3): V3 => [a+u, b+v, c+w];
export const sub3 = ([a, b, c]: V3, [u, v, w]: V3): V3 => [a-u, b-v, c-w];
export const cross = ([a, b, c]: V3, [u, v, w]: V3): V3 => [b*w-c*v, c*u-w*a, a*v-b*u];
export const norm3 = ([a, b, c]: V3): number => Math.hypot(a, b, c);
export const dot3 = ([a, b, c]: V3, [u, v, w]: V3): number => a*u+b*v+c*w;
export const add3s = ([a, b, c]: V3, s: number): V3 => [a+s, b+s, c+s];
export const mul3 = ([a, b, c]: V3, s: number): V3 => [a*s, b*s, c*s];
export const unit3 = (v: V3): V3 => mul3(v, 1/norm3(v));
export const rot = (v: V3, ax: number, rad: number) => {
	const [i, j] = [[1, 2], [0, 2], [0, 1]][ax];
	const c = Math.cos(rad), s = Math.sin(rad);
	const nv = [...v] as V3;
	nv[i] = c*v[i]-s*v[j];
	nv[j] = s*v[i]+c*v[j];
	return nv;
};

export type M3 = [V3, V3, V3];
export const m3z = (): M3 => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
export const m3id = (): M3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const mulm3v3 = (a: M3, b: V3) => {
	let out: V3 = [0, 0, 0];
	for (let i = 0; i < 3; i++) out = add3(out, mul3(a[i], b[i]));
	return out;
};
export const mulm3 = (a: M3, b: M3) => {
	const out = m3z();
	for (let i = 0; i < 3; i++) out[i] = mulm3v3(a, b[i]);
	return out;
};
export const rotm3 = (ax: number, rad: number): M3 => {
	const [i, j] = [[1, 2], [0, 2], [0, 1]][ax];
	const k = 3^i^j;
	const c = Math.cos(rad), s = Math.sin(rad);
	const o = m3z();
	o[i][i] = o[j][j] = c;
	o[j][i] = -s;
	o[i][j] = s;
	o[k][k] = 1;
	return o;
};
export const orthom3 = (m3: M3): M3 => {
	const o = m3;
	for (let i = 1; i < 3; i++) {
		for (let j = 0; j < i; j++) {
			o[i] = sub3(o[i], mul3(m3[j], dot3(m3[j], o[i])/dot3(o[j], o[j])));
		}
		for (let j = 0; j < i; j++) {
			if (Math.abs(dot3(o[i], o[j])) > 1e-9) throw new Error("wa");
		}
	}
	return o;
};
export const unitm3 = (m3: M3): M3 => {
	const o = m3;
	for (let i = 0; i < 3; i++) o[i] = mul3(o[i], 1/norm3(o[i]));
	return o;
};

const EPS = 1e-6;

// returns t, intersection at d*t + c*(1-t)
export function intersect(a: V2, b: V2, c: V2, d: V2) {
	b = sub(b, a);
	c = sub(c, a);
	d = sub(d, a);

	const d1 = det(b, c), d2 = det(b, d);

	if (Math.abs(d1) < EPS && Math.abs(d2) < EPS) return "colinear" as const;
	else if (Math.abs(d2-d1) < EPS) return "none" as const;
	return -d1/(d2-d1);
}

export function polarSort(pts: V2[]) {
	pts.sort((a, b) => {
		const ay = Math.sign(a[1]), by = Math.sign(b[1]);
		return (ay == by || ay == 0 || by == 0) ? -det(a, b) : by-ay;
	});
}

export function cut(pts: V2[], a: V2, b: V2) {
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
}
