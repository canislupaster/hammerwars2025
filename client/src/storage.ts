import { parseExtra, stringifyExtra } from "../../shared/util";

export type LocalStorage = Partial<unknown> & { toJSON(): unknown };

const localStorageKeys: (Exclude<keyof LocalStorage, "toJSON">)[] = [];

export const LocalStorage = {} as unknown as LocalStorage;

for (const k of localStorageKeys) {
	Object.defineProperty(LocalStorage, k, {
		get() {
			const vStr = localStorage.getItem(k);
			return vStr != null ? parseExtra(vStr) : undefined;
		},
		set(newV) {
			if (newV == undefined) localStorage.removeItem(k);
			else localStorage.setItem(k, stringifyExtra(newV));
			return newV as unknown;
		},
	});
}
