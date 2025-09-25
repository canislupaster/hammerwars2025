import { makeShirt } from "../../shared/genshirt";

export type GenShirtMessage = {
	team: string;
	name: string;
	logo?: string;
	seed: number;
	hue: number;
	quality: "low" | "high";
};

export type GenShirtResponse = { type: "success"; data: ImageData } | {
	type: "error";
	msg: string;
};

export const channel = new BroadcastChannel("genShirt");

if (typeof WorkerGlobalScope != "undefined" && self instanceof WorkerGlobalScope) {
	self.onmessage = async ev => {
		const msg = ev.data as GenShirtMessage;
		const loadImage = async (src: string) => {
			try {
				const blob = await (await fetch(src)).blob();
				return await createImageBitmap(blob);
			} catch {
				throw new Error(`Couldn't load ${src}`);
			}
		};

		try {
			const canvas = await makeShirt({
				canvasConstructor: (w, h) => new OffscreenCanvas(w, h),
				team: msg.team,
				name: msg.name,
				seed: msg.seed,
				hue: msg.hue,
				quality: msg.quality,
				assets: {
					logo: msg.logo != undefined ? await loadImage(msg.logo) : undefined,
					base: await loadImage("/shirtbase.png"),
					bracket: await loadImage("/shirtbracket.png"),
				},
			});

			const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
			self.postMessage({ type: "success", data } satisfies GenShirtResponse);
		} catch (err) {
			console.error("worker error", err);
			self.postMessage(
				{
					type: "error",
					msg: err instanceof Error ? err.message : "Unknown error",
				} satisfies GenShirtResponse,
			);
		}
	};
}
