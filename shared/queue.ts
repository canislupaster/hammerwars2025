export class Queue<T> {
	private arr: T[] = [];
	constructor(private cmp: (a: T, b: T) => boolean) {}
	push(x: T) {
		this.arr.push(x);
		let i = this.arr.length;
		while (i >= 2 && this.cmp(this.arr[i-1], this.arr[(i>>1)-1])) {
			[this.arr[(i>>1)-1], this.arr[i-1]] = [this.arr[i-1], this.arr[(i>>1)-1]];
			i >>= 1;
		}
	}
	size() {
		return this.arr.length;
	}
	pop(): T {
		const ret = this.arr[0];
		const last = this.arr.pop()!;
		if (this.arr.length > 0) this.arr[0] = last;

		let i = 1;
		while (true) {
			const right = 2*i < this.arr.length && this.cmp(this.arr[2*i], this.arr[2*i-1]);
			if (!right && 2*i-1 < this.arr.length && this.cmp(this.arr[2*i-1], this.arr[i-1])) {
				[this.arr[2*i-1], this.arr[i-1]] = [this.arr[i-1], this.arr[2*i-1]];
				i *= 2;
			} else if (right && this.cmp(this.arr[2*i], this.arr[i-1])) {
				[this.arr[2*i], this.arr[i-1]] = [this.arr[i-1], this.arr[2*i]];
				i = 2*i+1;
			} else {
				break;
			}
		}

		return ret;
	}
}
