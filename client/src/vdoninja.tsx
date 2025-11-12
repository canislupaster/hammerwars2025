import { ComponentChildren, createContext, JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { twJoin, twMerge } from "tailwind-merge";
import { Loading } from "./ui";

type VDONinjaContext = {
	add(video: HTMLVideoElement, room: string): () => void;
	incRoom(room: string): void;
	decRoom(room: string): void;
};

const Context = createContext<VDONinjaContext>({
	add() {
		return () => {};
	},
	incRoom() {},
	decRoom() {},
});

export function VDONinjaLoader(
	{ rooms, children }: { rooms?: string[]; children: ComponentChildren },
) {
	type TrackKind = "video" | "audio";

	type TrackEntry = {
		kind: TrackKind;
		streamID: string;
		generator: MediaStreamTrackGenerator<VideoFrame | AudioData>;
		frameWriter: WritableStreamDefaultWriter<VideoFrame | AudioData>;
	};

	type MediaState = {
		rooms: Map<string, [MediaStream, Map<string, TrackEntry>, HTMLIFrameElement]>;
		roomFrames: Map<Window, string>;
		roomCount: Map<string, number>;
	};

	const container = useRef<HTMLDivElement>(null);
	const [ctx, setCtx] = useState<VDONinjaContext>();

	useEffect(() => {
		const media: MediaState = { rooms: new Map(), roomFrames: new Map(), roomCount: new Map() };
		const el = container.current;
		if (!el) return;
		console.log("starting vdo ninja loader");

		const getRoom = (room: string) => {
			let r = media.rooms.get(room);
			if (r != null) return r;

			console.log("loading vdo ninja room", room);
			const url = new URL("/vdo/", window.location.href);
			url.searchParams.set("view", room.toString());
			url.searchParams.set("scale", "100");
			url.searchParams.set("volume", "0");
			for (const param of ["cleanoutput", "manual", "sendframes"]) {
				url.searchParams.set(param, "");
			}
			const frame = document.createElement("iframe");
			frame.sandbox = "allow-scripts allow-same-origin";
			frame.allow = "autoplay";
			frame.src = url.href;
			r = [new MediaStream(), new Map<string, TrackEntry>(), frame];
			media.rooms.set(room, r);
			frame.onload = () => {
				if (frame.contentWindow == null) throw new Error("frame contentwindow null");
				media.roomFrames.set(frame.contentWindow, room);
			};
			el.appendChild(frame);

			return r;
		};

		const elements = new Set<HTMLVideoElement>();

		const closeTrack = (stream: MediaStream, t: TrackEntry) => {
			void t.frameWriter.close();
			stream.removeTrack(t.generator);
			t.generator.stop();
		};

		const onMessage = (e: MessageEvent) => {
			const room = media.roomFrames.get(e.source as Window);
			if (room == null) return;
			const [stream, tracks] = media.rooms.get(room)!;

			const data = e.data as {
				frame: VideoFrame | AudioData;
				kind: TrackKind;
				trackID: string;
				streamID: string;
			} | { action: "push-connection"; streamId: string; value: boolean };

			if ("frame" in data) {
				let track = tracks.get(data.trackID);
				if (track == null) {
					track = {
						kind: data.kind,
						streamID: data.streamID,
						generator: data.kind == "audio"
							? new MediaStreamTrackGenerator({ kind: "audio" })
							: new MediaStreamTrackGenerator({ kind: "video" }),
						frameWriter: {} as WritableStreamDefaultWriter<VideoFrame | AudioData>,
					};

					console.log(`adding ${data.kind} track`, data.trackID);
					stream.addTrack(track.generator);
					track.frameWriter = track.generator.writable.getWriter();
					tracks.set(data.trackID, track);
				}

				void track.frameWriter.write(data.frame);
				// vdo closes frame in lib.js
			}

			if ("action" in data && data.action == "push-connection" && data.value == false) {
				for (const [k, v] of tracks) {
					if (v.streamID == data.streamId) {
						tracks.delete(k);
						console.log("removing track", k);
						closeTrack(stream, v);
					}
				}
			}
		};

		const delRoom = (room: string) => {
			const [stream, tracks, frame] = media.rooms.get(room)!;
			tracks.values().forEach(trk => closeTrack(stream, trk));
			if (stream.getTracks().length > 0) throw new Error("couldn't clean up stream");
			media.rooms.delete(room);
			media.roomFrames.delete(frame.contentWindow!);
			media.roomCount.delete(room);
			frame.remove();
			console.log("removing room", room);
		};

		let alive = true;
		const incRoom = (r: string) => {
			if (!alive) throw Error("this context is destroyed");
			media.roomCount.set(r, (media.roomCount.get(r) ?? 0)+1);
			return getRoom(r);
		};

		const decRoom = (room: string) => {
			if (!alive) return;
			const count = media.roomCount.get(room);
			if (count == null || count <= 0) throw new Error("bad ref count");
			media.roomCount.set(room, count-1);
			if (count == 1) delRoom(room);
		};

		const add = (video: HTMLVideoElement, room: string) => {
			const [stream] = incRoom(room);
			video.srcObject = stream;
			elements.add(video);
			return () => {
				elements.delete(video);
				video.pause();
				video.srcObject = null;
				decRoom(room);
			};
		};

		window.addEventListener("message", onMessage);
		setCtx({ add, incRoom, decRoom });

		return () => {
			alive = false;
			setCtx(undefined);
			window.removeEventListener("message", onMessage);

			elements.forEach(x => {
				x.pause();
				x.srcObject = null;
			});

			media.rooms.keys().forEach(k => delRoom(k));
		};
	}, []);

	const curRooms = useRef(new Set<string>());
	useEffect(() => {
		if (ctx == null) return;
		const nrooms = new Set(rooms ?? []);
		for (const r of nrooms) ctx.incRoom(r);
		for (const r of curRooms.current) ctx.decRoom(r);
		curRooms.current = nrooms;
	}, [ctx, rooms]);

	return <>
		<div ref={container} className="w-1 h-1 opacity-0 absolute top-0 left-0" />
		{ctx != null && <Context.Provider value={ctx}>{children}</Context.Provider>}
	</>;
}

export function VDONinjaPlayer(
	{ room, className, ...props }: { room: string; className?: string }
		& JSX.IntrinsicElements["video"],
) {
	const ref = useRef<HTMLVideoElement>(null);
	const ctx = useContext(Context);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		return ctx.add(el, room);
	}, [ctx, room]);
	const [loaded, setLoaded] = useState(false);
	return <>
		<video onCanPlay={() => setLoaded(true)} autoPlay {...props} ref={ref}
			className={twMerge(!loaded && "invisible absolute", className)}
			onClick={el => void el.currentTarget.play()} />
		{!loaded && <Loading className={className} />}
	</>;
}
