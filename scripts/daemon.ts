import { serve } from "@hono/node-server";
import { parse } from "dotenv";
import { Hono } from "hono";
import { JSDOM } from "jsdom";
import { ChildProcess, execFile, ExecOptionsWithStringEncoding, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { Canvas, FontLibrary, loadImage, loadImageData } from "skia-canvas";
import { APIClient, delay, DOMJudgeActiveContest, forever, parseExtra,
	stringifyExtra } from "../shared/util";

console.log(`daemon started in ${process.cwd()}`);

const updater = new Set<(old: Data) => void>();
type RegisterParams = ["bg", string, () => Promise<void>] | [
	"update",
	string,
	(old: Data) => Promise<void>,
];

function register(...params: RegisterParams) {
	const run = async (retryLimit: number | null, f: () => Promise<void>) => {
		let curDelay = 0;
		for (let i = 0; retryLimit != null ? (i < retryLimit) : true; i++) {
			const start = Date.now();
			try {
				await f();
				return;
			} catch (e) {
				const end = Date.now();
				console.error(`${params[1]} failed after ${end-start}ms`);
				console.error(e);
				curDelay = end-start > 5000 ? 0 : Math.min(1.1*curDelay+100, 5000);
				console.log(`retrying in ${curDelay}ms`);
			}

			await delay(curDelay);
		}
	};

	if (params[0] == "bg") {
		void run(null, async () => {
			while (true) await params[2]();
		});
	} else {
		let lastRunning = run(5, () => params[2]({}));
		updater.add(old => {
			lastRunning = lastRunning.then(() => run(5, () => params[2](old)));
		});
	}
}

function restart(): never {
	// this definitely stops the process but it seems like systemd is still restarting it very funny (i don't care 🤓)
	return process.execve!(process.execPath, [...process.execArgv, ...process.argv.slice(1)]);
}

const client = new APIClient(process.env["API_URL"]!, {
	apiKey: process.env["API_KEY"]!,
	session: null,
});

type Data = Partial<
	{
		teamId: number;
		teamIdWorks: boolean;
		registeredTimeMs: number;
		lastAnnouncementId: number;
		latestAnnouncementId: number | null;
		lastScreenshot: number;
		currentDaemonVersion: number | null;
		latestDaemonVersion: number | null;
		screenshotsEnabled: boolean;
		lastState: { user: string; pass: string };
		domJudgeCookies: Map<string, string>;
		visibleDirectories: Set<string>;
		firewall: boolean;
		loginLocked: boolean;
		files: Map<number, string>;
		latestFileIds: number[];
		lastActive: DOMJudgeActiveContest;
		currentPrinter: { ip: string; cupsName: string; port: number; address: string } | null;
		latestPrinterAddress: string | null;
	}
>;

let data: Readonly<Data> = {};

const waitForDataChange = () =>
	new Promise<Data>(res => {
		const cb = (old: Data) => {
			res(old);
			updater.delete(cb);
		};
		updater.add(cb);
	});

if (await stat("data.json").catch(() => false) != false) {
	data = parseExtra(await readFile("data.json", "utf-8")) as Readonly<Data>;
}

function update(newData: Data) {
	const old = data;
	data = { ...data, ...newData };
	// no overlapping writes!
	writeFileSync("data.json", stringifyExtra(data));
	for (const upd of updater.values()) {
		upd?.(old);
	}
}

const domJudgeProxy = new Hono();

// prevent logout lmao
domJudgeProxy.all("/logout", async c => {
	return c.redirect("/");
});

domJudgeProxy.notFound(async c => {
	const u = new URL(c.req.url);
	const domUrl = new URL(process.env["DOMJUDGE_URL"]!);
	for (const k of ["port", "host", "protocol"] as const) u[k] = domUrl[k];
	const isApi = u.pathname.startsWith("/api/");
	console.log(`requesting ${u.href}`);

	const filteredCookies = [
		...[...data.domJudgeCookies?.entries() ?? []].map(([k, v]) => `${k}=${v}`),
		...(c.req.header("Cookie") ?? "").split("; ").filter(x =>
			data.domJudgeCookies == undefined || !data.domJudgeCookies.has(x.split("=")[0])
		),
	].join("; ");

	const authHeader = data.lastState && isApi
		? `Basic ${Buffer.from(`${data.lastState.user}:${data.lastState.pass}`).toString("base64")}`
		: null;

	const resp = await fetch(u, {
		headers: {
			...c.req.raw.headers,
			cookie: filteredCookies,
			...authHeader != null ? { authorization: authHeader } : {},
		},
		body: c.req.raw.body ? await c.req.blob() : null,
		method: c.req.method,
		redirect: "manual",
		credentials: "include",
		cache: "no-cache",
	});

	const hdr = new Headers(resp.headers);
	for (const k of ["content-length", "content-encoding", "transfer-encoding"]) hdr.delete(k);
	return new Response(resp.body, { ...resp, headers: hdr });
});

serve({ fetch: domJudgeProxy.fetch, port: 9100 });

type ExecOpts = ExecOptionsWithStringEncoding & { quiet?: boolean; ignoreExitCode?: boolean };

async function exec(cmd: string, args: string[] | null = null, options?: ExecOpts) {
	if (options?.quiet != true) {
		console.log(
			`executing ${cmd} ${
				args == null ? "" : args.map(v => `"${v.replaceAll("\"", "\\\"")}"`).join(" ")
			}`,
		);
	}
	return new Promise<{ stdout: string; stderr: string; code: number | null }>((res, rej) =>
		execFile(
			cmd,
			args,
			{ encoding: "utf-8", shell: args == null, ...options },
			(err, stdout, stderr) => {
				if (err != null && options?.ignoreExitCode != true) {
					rej(new Error("Exec failed", { cause: err }));
				}
				res({ stdout, stderr, code: (err?.code as number | null | undefined) ?? 0 });
			},
		)
	);
}

async function getEnv(proc: string, retry: number = Infinity) {
	let pids: string[] = [];
	while (pids.length == 0 && retry-- > 0) {
		await delay(500);
		pids = (await exec("pgrep", [proc], { quiet: true }).catch(() =>
			null
		))?.stdout?.trim()?.split("\n") ?? [];
	}

	for (const p of pids) {
		const env = parse(
			(await readFile(join("/proc", p, "/environ"), "utf-8")).replaceAll("\0", "\n"),
		);
		if (env["USER"] != "team") continue;
		return env;
	}

	return null;
}

const getXfceEnv = () => getEnv("xfce4-session");

const teamUid = Number.parseInt((await exec("id -u team")).stdout);
const teamGid = Number.parseInt((await exec("id -g team")).stdout);
if (!isFinite(teamUid) || !isFinite(teamGid)) {
	throw new Error("Team user id or group id not found");
}

async function runTeam(cmd: string, args: string[] | null = null, options?: ExecOpts) {
	const env = await getXfceEnv();
	if (env == null) throw new Error("no team xfce session, they probably aren't logged in");
	return await exec(cmd, args, { env, uid: teamUid, gid: teamGid, ...options ?? {} });
}

async function startDevDocs() {
	let devDocs: ChildProcess | undefined;
	try {
		console.log("starting devdocs");
		devDocs = spawn("bundle install && bundle exec rackup", {
			cwd: join(process.cwd(), "../devdocs"),
			shell: true,
		});

		const d = devDocs;
		const p = (ev: "spawn" | "exit") =>
			new Promise<void>((res, rej) => {
				d.once(ev, () => res());
				d.once("error", err => rej(err));
			});

		await p("spawn");
		console.log("devdocs started");

		await p("exit");
		throw new Error(`devdocs exited with code ${devDocs.exitCode}`);
	} finally {
		if (devDocs?.exitCode == null) devDocs?.kill();
	}
}

register("bg", "devdocs", startDevDocs);

// cursed! but i'm not about to patch domjudge for this
async function updateDomJudgeCookies(old: Data) {
	if (
		isDeepStrictEqual(old.lastState, data.lastState) && old.lastActive?.cid == data.lastActive?.cid
	) {
		return;
	}

	const state = data.lastState;
	if (state == null) {
		update({ domJudgeCookies: new Map() });
		return;
	}

	const loginUrl = new URL("/login", process.env["DOMJUDGE_URL"]).href;
	const dom = await JSDOM.fromURL(loginUrl);
	const form = new FormData();
	form.append(
		"_csrf_token",
		(dom.window.document.querySelector(`input[name=_csrf_token]`) as HTMLInputElement).value,
	);

	form.append("_username", state.user);
	form.append("_password", state.pass);

	const setCookie =
		(await fetch(loginUrl, {
			method: "POST",
			body: form,
			redirect: "manual",
			headers: { cookie: await dom.cookieJar.getCookieString(loginUrl) },
		})).headers.get("set-cookie");

	const phpSessionId =
		setCookie?.split("; ").map(v => v.split("=")).find(v => v[0] == "PHPSESSID")?.[1] ?? null;
	if (phpSessionId == null) throw new Error("missing session id");

	const resp2 = await fetch(loginUrl, {
		redirect: "manual",
		headers: { cookie: `PHPSESSID=${phpSessionId};` },
	});

	if (![302, 200].includes(resp2.status)) {
		throw new Error(`failed to login to domjudge: ${resp2.status} ${resp2.statusText}`);
	}

	const cookies: [string, string][] = [["PHPSESSID", phpSessionId]];
	if (data.lastActive?.cid != null) cookies.push(["domjudge_cid", data.lastActive.cid]);

	console.log("updated domjudge cookies");
	update({ domJudgeCookies: new Map(cookies) });
}

register("update", "domjudge cookies", updateDomJudgeCookies);

async function updateFirewall(old: Data) {
	if (old.firewall == data.firewall) return;

	if (data.firewall == true) {
		await exec("ufw default deny outgoing");
		await runTeam(`zenity --notification --text="Internet access disabled"`, null, {
			ignoreExitCode: true,
		});
	} else {
		await exec("ufw default allow outgoing");
		await runTeam(`zenity --notification --text="Internet access enabled"`, null, {
			ignoreExitCode: true,
		});
	}
}

register("update", "firewall", updateFirewall);

async function updateLogin(old: Data) {
	if (old.loginLocked == data.loginLocked) return;
	await exec("passwd", [data.loginLocked == true ? "-l" : "--delete", "team"]);
}

register("update", "login", updateLogin);

async function updateVisible(old: Data) {
	if (data.visibleDirectories == undefined) {
		update({ visibleDirectories: new Set() });
	} else if (
		data.visibleDirectories.symmetricDifference(old.visibleDirectories ?? new Set()).size == 0
	) {
		return;
	}

	const dirs = new Set(process.env["DIRECTORIES"]!.split(","));
	const concatDirs = (x: string[]) => x.map(v => join("/home/team/", v));
	const invis = [...dirs.difference(data.visibleDirectories ?? new Set()).values()];
	if (invis.length > 0) await exec("chmod", ["a-rwx", ...concatDirs(invis)]);

	const vis = [...data.visibleDirectories?.intersection(dirs)?.values() ?? []];
	console.log(`updating visible directories to ${vis.join(", ")}`);
	if (vis.length > 0) await exec("chmod", ["a=rX", ...concatDirs(vis)]);
}

register("update", "visibility", updateVisible);

async function setTeamId() {
	while (data.teamId == undefined) {
		const out =
			(await runTeam("zenity --entry --text='Enter team ID' --title='Configure system'")).stdout;

		const outNum = Number.parseInt(out);
		if (isFinite(outNum)) {
			update({ teamId: outNum, registeredTimeMs: Date.now() });
		} else {
			await runTeam("zenity --error --title='Invalid team ID'");
		}

		await delay(5000);
	}

	await forever;
}

register("bg", "team id", setTeamId);

const screenshotInterval = 1000*5;
async function takeScreenshots() {
	const macHash = Buffer.from(
		await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(
				(await exec("cat /sys/class/net/*/address")).stdout.split("\n").sort().join("\n"),
			),
		),
	).toString("hex");

	console.log(`screenshot using mac hash ${macHash}`);

	while (true) {
		if (data.teamId == undefined) {
			await waitForDataChange();
			continue;
		}

		const teamId = data.teamId;

		if (data.lastScreenshot != undefined) {
			await delay(Math.max(0, data.lastScreenshot+screenshotInterval-Date.now()));
		}

		update({ lastScreenshot: Date.now() });

		if (data.screenshotsEnabled == true) {
			const screenshotPath = process.env["SCREENSHOT_PATH"]!;
			await exec("xfce4-screenshooter", ["-f", "-m", "-s", screenshotPath], {
				env: await getXfceEnv() ?? {},
			});
			const b64 = (await readFile(screenshotPath)).toString("base64");
			await client.request("screenshot", { team: teamId, data: b64, mac: macHash });
			await rm(screenshotPath);
		}
	}
}

register("bg", "screenshot", takeScreenshots);

async function openFirefox(url: string) {
	const firefoxEnv = await getEnv("firefox", 1);
	await runTeam("firefox", ["--new-tab", "--url", url], {
		env: firefoxEnv ?? (await getXfceEnv() ?? {}),
	});
}

async function contestNotification(old: Data) {
	if (old.lastActive?.cid == data.lastActive?.cid) return;
	if (data.lastActive) {
		const res = await runTeam("zenity", [
			"--question",
			"--text",
			"Open problems?",
			"--title",
			data.lastActive.name != undefined
				? `Contest ${data.lastActive.name} has started`
				: "The contest has started",
		], { ignoreExitCode: true });

		if (res.code == 0) await openFirefox(process.env["PROBLEMS_URL"]!);
	} else {
		await runTeam("zenity", [
			"--info",
			"--text",
			"We hope you enjoyed it!",
			"--title",
			old.lastActive?.name != undefined
				? `Contest ${old.lastActive.name} has ended`
				: "The contest has ended",
		]);
	}
}

register("update", "notification", contestNotification);

async function processFeed() {
	while (data.teamId == undefined) await waitForDataChange();
	const teamId = data.teamId;

	console.log(`connecting to feed (team id = ${teamId})`);

	const feed = client.feed("teamFeed", { id: teamId });
	console.log("connected to feed");

	try {
		for await (const event of feed) {
			const state = event.state.domJudgeCredentials != null
				? { user: event.state.domJudgeCredentials.user, pass: event.state.domJudgeCredentials.pass }
				: undefined;

			const vis = new Set(event.state.teamProperties.visibleDirectories);

			if (
				event.state.unregisterMachineTimeMs != null && data.registeredTimeMs != null
				&& event.state.unregisterMachineTimeMs > data.registeredTimeMs
			) {
				update({ teamId: undefined, teamIdWorks: undefined });
				// don't really handle clearing id well yet, just restart
				return restart();
			}

			update({
				teamIdWorks: true,
				firewall: event.state.teamProperties.firewallEnabled,
				latestAnnouncementId: event.state.lastAnnouncementId,
				latestFileIds: event.state.teamFiles,
				visibleDirectories: vis,
				screenshotsEnabled: event.state.teamProperties.screenshotsEnabled,
				lastState: state,
				lastActive: event.state.domJudgeActiveContest,
				loginLocked: event.state.teamProperties.loginLocked,
				latestDaemonVersion: event.state.daemonVersion,
				latestPrinterAddress: event.state.printerName,
			});
		}
	} catch (err: unknown) {
		if (data.teamIdWorks == true) {
			throw err;
		}
		console.error("couldn't fetch feed", err);
		console.log("restarting without team id");
		update({ teamId: undefined });
		return restart();
	}
}

register("bg", "feed", processFeed);

FontLibrary.use("Oxanium", "./Oxanium-VariableFont_wght.ttf");

const wallpaperPath = "/usr/share/wallpaper.png";
async function reloadWallpaper() {
	const props = (await runTeam("xfconf-query -c xfce4-desktop -l")).stdout.split("\n").filter(x =>
		x.endsWith("last-image")
	);
	for (const p of props) {
		await runTeam("xfconf-query", ["-c", "xfce4-desktop", "-p", p, "-s", ""]);
	}
	await delay(500);
	for (const p of props) {
		await runTeam("xfconf-query", ["-c", "xfce4-desktop", "-p", p, "-s", wallpaperPath]);
	}
}

async function setWallpaper() {
	if (data.teamId == undefined) {
		await copyFile("./wallpaper.png", wallpaperPath);
		await reloadWallpaper();
	}

	while (data.teamId == undefined) await waitForDataChange();

	const info = await client.request("teamInfo", { id: data.teamId });
	const w = 3900, h = 2340;
	const canvas = new Canvas(w, h);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(await loadImage("./wallpaper.png"), 0, 0);

	// mildly copy pasted from genshirt 🤷
	const textBox = (txt: string, w: number, maxH: number, pos: [number, number], weight: number) => {
		const condense = 2;
		const minTextSize = 200;

		ctx.letterSpacing = `-${condense}px`;
		ctx.font = `${weight} ${minTextSize}px Oxanium`;
		const w2 = ctx.measureText(txt);
		if (w2.width == 0 || w2.actualBoundingBoxAscent == 0) return 0;
		const mult = Math.max(1, Math.min(w/w2.width, maxH/w2.actualBoundingBoxAscent));
		ctx.font = `${weight} ${minTextSize*mult}px Oxanium`;
		ctx.fillStyle = "white";
		ctx.letterSpacing = `-${mult*condense}px`;
		ctx.fillText(txt, pos[0], pos[1]-(maxH-w2.actualBoundingBoxAscent*mult)/2);
		ctx.letterSpacing = "0px";
		return pos[0]+mult*w2.width;
	};

	const maxw = info.logoId == null ? 3551.4 : 2868;
	const logoPos = Math.max(textBox(info.name, maxw, 278.7, [154, 2174.6], 800)+123.8, 3145.8);

	if (info.logoId != null) {
		const logoSize = 3812.8-logoPos;
		const { base64 } = await client.request("getTeamLogo", { id: info.logoId });
		ctx.drawImage(
			await loadImageData(sharp(Buffer.from(base64, "base64"))),
			logoPos,
			2253.3-logoSize,
			logoSize,
			logoSize,
		);
	}

	await writeFile(wallpaperPath, await canvas.png);
	console.log("generated wallpaper");
	await reloadWallpaper();

	await forever;
}

register("bg", "wallpaper", setWallpaper);

async function copyRunner() {
	const runPath = "/usr/local/bin/run";

	await copyFile("./run", runPath);
	await exec("chmod", ["a=rx", runPath]);
	for (const d of ["compare.cpp", "run.mts"]) {
		await copyFile(d, join(dirname(runPath), d));
		await exec("chmod", ["a=r", d]);
	}

	console.log("copied run script");
	await forever;
}

register("bg", "copyRunner", copyRunner);

async function announcement() {
	if (
		data.latestAnnouncementId == null
		|| (data.lastAnnouncementId != null && data.lastAnnouncementId >= data.latestAnnouncementId)
		|| data.teamId == null
	) return;

	const announcement = await client.request("getAnnouncement", {
		team: data.teamId,
		afterId: data.lastAnnouncementId ?? null,
	});

	if (
		announcement == null
		|| (data.lastAnnouncementId != null && announcement.id <= data.lastAnnouncementId)
	) {
		return;
	}

	update({ ...data, lastAnnouncementId: announcement.id });

	const sec = Math.floor((Date.now()-announcement.time)/1000);
	await runTeam("zenity", [
		"--info",
		"--text",
		`${announcement.body}\n\nSent ${sec} seconds ago.`,
		"--title",
		announcement.title,
	]);
}

register("update", "announcement", announcement);

async function files() {
	// disallow file downloading when internet disabled
	if (data.firewall == true) return;
	const oldFileSet = new Set(data.files?.keys() ?? []);
	const newFileSet = new Set(data.latestFileIds ?? []);
	if (oldFileSet.symmetricDifference(newFileSet).size == 0) return;
	const teamFilePath = "/home/team/files";

	await mkdir(join(teamFilePath), { recursive: true });
	await exec("chmod", ["a=rwx", teamFilePath]);

	const newFiles = new Map(data.files);
	for (const deleteFile of oldFileSet.difference(newFileSet)) {
		const name = data.files!.get(deleteFile)!;
		console.log(`deleting ${name}`);
		await rm(join(teamFilePath, name), { force: true });
		newFiles.delete(deleteFile);
	}

	for (const downloadFile of newFileSet.difference(oldFileSet)) {
		const { name, base64 } = await client.request("getTeamFile", { id: downloadFile });
		console.log(`downloading ${name}`);
		const path = normalize(join(teamFilePath, name));
		if (!path.startsWith(teamFilePath)) {
			console.error(`skipping ${path}`);
			continue;
		}
		await writeFile(path, Buffer.from(base64, "base64"));
		await exec("chmod", ["a=rw", path]);
		newFiles.set(downloadFile, name);
	}

	update({ ...data, files: newFiles });
}

register("update", "files", files);

// added hot patching just in case stuff breaks and i need to update all machines
// but i hope i don't need this trash!
async function updateDaemon() {
	if (
		data.latestDaemonVersion == undefined
		|| (data.currentDaemonVersion == null && data.latestDaemonVersion == null)
		|| (data.currentDaemonVersion != null && data.currentDaemonVersion >= data.latestDaemonVersion)
	) return;

	const daemonSource = await client.request("getDaemonSource");
	if (daemonSource == null || daemonSource.version < data.latestDaemonVersion) {
		throw new Error("mismatched daemon version during update");
	}

	await writeFile(import.meta.filename, daemonSource.source);
	update({ ...data, currentDaemonVersion: daemonSource.version });
	restart();
}

register("update", "update daemon", updateDaemon);

const printerName = "printer";
async function configurePrinter() {
	if ((data.latestPrinterAddress ?? null) == (data.currentPrinter?.address ?? null)) return;

	if (data.currentPrinter != null) {
		console.log(
			`removing printer ${data.currentPrinter.cupsName} at ${data.currentPrinter.address}`,
		);
		await exec("lpadmin", ["-x", data.currentPrinter.cupsName]);
		await exec("ufw", [
			"delete",
			"allow",
			"out",
			"to",
			data.currentPrinter.ip,
			"port",
			data.currentPrinter.port.toString(),
		]);
	}

	if (data.latestPrinterAddress != null) {
		const ipPort = data.latestPrinterAddress.split(":");
		const ip = ipPort[0];
		const port = ipPort.length == 1 ? 9100 : Number(ipPort[1]);
		if (!isFinite(port)) throw new Error(`invalid printer port ${port}`);
		const newPrinter = { cupsName: printerName, ip, port, address: data.latestPrinterAddress };
		console.log(
			`adding printer ${newPrinter.cupsName} at ${newPrinter.address} (ip ${newPrinter.ip}, port ${newPrinter.port})`,
		);

		await exec("lpadmin", [
			"-p",
			newPrinter.cupsName,
			"-E",
			"-v",
			`socket://${newPrinter.ip}:${newPrinter.port}`,
		]);

		await exec("lpoptions", ["-p", newPrinter.cupsName, "-o", "job-sheets=none,none"]);
		await exec("lpoptions", ["-d", newPrinter.cupsName]);
		await exec("ufw", ["allow", "out", "to", newPrinter.ip, "port", newPrinter.port.toString()]);

		update({ currentPrinter: newPrinter });
	} else {
		update({ currentPrinter: null });
	}
}

register("update", "printer", configurePrinter);
