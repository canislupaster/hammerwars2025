export type V2 = [number, number];
export const det = (a: V2, b: V2) => a[0]*b[1]-a[1]*b[0];
export const dot = (a: V2, b: V2) => a[0]*b[0]+a[1]*b[1];
export const sub = (a: V2, b: V2): V2 => [a[0]-b[0], a[1]-b[1]];
export const add = (a: V2, b: V2): V2 => [a[0]+b[0], a[1]+b[1]];
export const mul = (a: V2, c: number): V2 => [a[0]*c, a[1]*c];

export type V3 = [number, number, number];
export const add3 = ([a, b, c]: V3, [u, v, w]: V3): V3 => [a+u, b+v, c+w];
export const dot3 = ([a, b, c]: V3, [u, v, w]: V3): number => a*u+b*v+c*w;
export const add3s = ([a, b, c]: V3, s: number): V3 => [a+s, b+s, c+s];
export const mul3 = ([a, b, c]: V3, s: number): V3 => [a*s, b*s, c*s];
export const rot = (v: V3, ax: number, rad: number) => {
	const [i, j] = [[1, 2], [0, 2], [0, 1]][ax];
	const c = Math.cos(rad), s = Math.sin(rad);
	const nv = [...v] as V3;
	nv[i] = c*v[i]-s*v[j];
	nv[j] = s*v[i]+c*v[j];
	return nv;
};

const EPS = 0.1;

export function intersect(a: V2, b: V2, c: V2, d: V2) {
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
