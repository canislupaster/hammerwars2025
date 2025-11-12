import { ComponentChildren, Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { twJoin } from "tailwind-merge";
import { ContestProperties } from "../../shared/util";
import { apiKeyClient, LocalStorage, useRequest } from "./clientutil";
import { MainContainer } from "./main";
import { bgColor, borderColor, Button, Card, Divider, Input, Loading, Text } from "./ui";

function ClickerQueueItem(
	{ v, active, jump, loading }: {
		v: ContestProperties["presentation"]["queue"][number];
		active: boolean;
		jump: () => void;
		loading: boolean;
	},
) {
	let title: string;
	let details: [string, ComponentChildren][] = [];
	if (v.type == "countdown") {
		title = "Countdown";
		details = [["Until", new Date(v.to).toLocaleString()], ["Title", v.title]];
	} else if (v.type == "submissions") {
		title = "Submissions";
	} else if (v.type == "live") {
		title = "Live";
		details = [["Source", v.src], [
			"Preview",
			<video src={v.src} autoplay muted key={v.src} className="max-h-[20dvh]" />,
		]];
	} else if (v.type == "image") {
		title = "Image";
		details = [["Source", v.src], [
			"Preview",
			<img src={v.src} key={v.src} className="max-h-[20dvh]" />,
		]];
	} else if (v.type == "video") {
		title = "Video";
		details = [["Source", v.src], ["Logo", v.logo ?? "(none)"]];
	} else if (v.type == "duel") {
		title = "Duel";
		details = [["Contest ID", v.cfContestId], ["Layout", v.layout], [
			"Players",
			v.players.map(x => x.name).join(", "),
		]];
	} else if (v.type == "scoreboard") {
		title = "Scoreboard";
	} else {
		return v satisfies never;
	}

	return <Card className={twJoin(active && bgColor.secondary, active && borderColor.blue)}>
		<div className="flex flex-row gap-2 items-center">
			{active
				&& <span
					className={twJoin(
						"rounded-full animate-pulse h-5 shrink-0 aspect-square",
						bgColor.red,
					)} />}
			<Text v="bold">{title}</Text>
			<span className="mx-auto" />
			{!active && <Button loading={loading} onClick={jump}>Jump</Button>}
		</div>
		{details.length > 0 && <>
			<Divider />
			<div className="grid grid-cols-[auto_1fr_auto] gap-2 self-center items-center">
				{details.map(([k, v]) =>
					<Fragment key={k}>
						<Text v="smbold" className="text-right">{k}</Text> <Divider className="h-full" vert />
						{" "}
						<div>{v}</div>
					</Fragment>
				)}
			</div>
		</>}
	</Card>;
}

function ClickerQueue() {
	const presentationQueue = useRequest({
		route: "getPresentationQueue",
		initRequest: true,
		client: apiKeyClient,
	});
	const setProperties = useRequest({
		route: "setProperties",
		client: apiKeyClient,
		handler() {
			presentationQueue.call();
		},
	});
	const data = presentationQueue.current?.data;
	const queueRef = useRef<HTMLDivElement>(null);
	const curI = data?.current;
	useEffect(() => {
		const d = queueRef.current;
		if (curI == null || !d) return;
		let lastHeight: number | null = null;
		let tm: number | null = null;
		const cb = () => {
			if (lastHeight == d.scrollHeight) {
				tm = null;
				return;
			}
			const curEl = d.children.item(curI) as HTMLElement;
			if (curEl == null) return false;
			d.scrollTo({
				behavior: "smooth",
				top: curEl.offsetTop+curEl.offsetHeight/2-d.clientHeight/2,
			});
			lastHeight = d.scrollHeight;
			tm = setTimeout(cb, 200);
		};
		cb();
		return () => {
			if (tm != null) clearTimeout(tm);
		};
	}, [curI]);

	const move = (d: number) => {
		if (data == null) return;
		setProperties.call({ presentation: { ...data, current: data.current+d } });
	};

	const l = data == null || setProperties.loading;

	return <>
		<Text v="md">Queue</Text>
		{data == null
			? <Loading />
			: data.queue.length == 0
			? <Text v="dim">There's nothing here.</Text>
			: <div className="flex flex-col gap-2 w-full max-h-[70dvh] overflow-auto relative"
				ref={queueRef}>
				{data.queue.map((v, i) =>
					<ClickerQueueItem key={i} v={v} loading={l} active={i == data.current} jump={() => {
						move(i-data.current);
					}} />
				)}
			</div>}
		<div className="flex flex-row flex-wrap gap-2 w-full justify-between">
			<Button loading={l} disabled={data != null && data.current <= 0} onClick={() => move(-1)}
				className="w-full md:w-auto">
				Previous
			</Button>
			<Button loading={l} disabled={data != null && data.current >= data.queue.length-1}
				onClick={() => move(1)} className="w-full md:w-auto">
				Next
			</Button>
		</div>

		<Text v="md">Live</Text>
		<div className="flex flex-row gap-2">
			{data == null || data?.live.length == 0
				? <Text>No sources set up.</Text>
				: data.live.map((v, i) => (<Card key={i} className="">
					<Text v="md">{v.name}</Text>
					<div className="flex flex-row gap-2 items-center">
						{([["overlay", "active"], ["active", "overlay"]] as const).map(([k, ok]) => {
							return <Button key={k}
								className={twJoin(v[k] && (k == "overlay" ? bgColor.sky : bgColor.red))} loading={l}
								onClick={() =>
									setProperties.call({
										live: data.live.map((u, j) => ({
											...u,
											[ok]: i == j ? false : u[ok],
											[k]: v[k] ? false : i == j,
										})),
									})}>
								{k[0].toUpperCase()}
								{k.slice(1)}
							</Button>;
						})}
					</div>

					<Text v="bold">Preview</Text>
					<video src={v.src} autoplay muted key={v.src} className="max-h-[20dvh]" />
				</Card>))}
		</div>
	</>;
}

export default function Clicker() {
	const [auth, setAuth] = useState<boolean | null>(null);
	const [apiKey, setApiKey] = useState<string>("");
	useEffect(() => {
		setAuth(LocalStorage.apiKey != undefined);
	}, []);
	if (auth == null) return <Loading />;
	if (!auth) {
		return <MainContainer>
			<form onSubmit={ev => {
				ev.preventDefault();
				if (apiKey == "") return;
				LocalStorage.apiKey = apiKey;
				setAuth(true);
			}} className="flex flex-col gap-2">
				<Text v="md">Enter key</Text>
				<Input value={apiKey} onInput={ev => setApiKey(ev.currentTarget.value)} />
				<Button>Continue</Button>
			</form>
		</MainContainer>;
	}
	return <MainContainer>
		<ClickerQueue />
	</MainContainer>;
}
