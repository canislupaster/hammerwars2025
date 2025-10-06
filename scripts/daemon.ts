import { parse } from "dotenv";
import { JSDOM } from "jsdom";
import { exec as execSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { APIClient, delay, DOMJudgeActiveContest } from "../shared/util";

const client = new APIClient(process.env["API_URL"]!, {
	apiKey: process.env["API_KEY"]!,
	session: null,
});

type Data = {
	teamId?: number;
	lastScreenshot?: number;
	browser?: { user: string; password: string };
	firewall?: boolean;
	lastActive?: DOMJudgeActiveContest;
};

let data: Readonly<Data> = {};
if (await stat("data.json").catch(() => false) != false) {
	data = JSON.parse(await readFile("data.json", "utf-8")) as Readonly<Data>;
}

async function update(newData: Data) {
	data = newData;
	await writeFile("data.json", JSON.stringify(newData));
}

async function getXfceEnv() {
	let pid: string | null = null;
	while (pid == null) {
		await delay(500);
		const pids = (await exec("pgrep xfce4-session").catch(() => null))?.stdout ?? "";
		pid = pids.split("\n")?.[0] ?? null;
	}

	return parse(await readFile(`/proc/${pid}/environ`, "utf-8"));
}

const exec = promisify(execSync);

while (data.teamId == undefined) {
	const out =
		(await exec("sudo -u team zenity --entry --text='Enter team ID' --title='Configure system'", {
			env: await getXfceEnv(),
		})).stdout;

	const outNum = Number.parseInt(out);
	if (isFinite(outNum)) {
		await update({ ...data, teamId: outNum });
	} else {
		await exec("sudo -u team zenity --error --title='Invalid team ID'", {
			env: await getXfceEnv(),
		});
	}
}

async function updateDomJudgeCookies({ user, pass }: { user: string; pass: string }) {
	const dom = await JSDOM.fromURL(new URL("/login", process.env["CONTEST_URL"]).href);
	const form = new FormData();
	form.append(
		"_csrf_token",
		(dom.window.document.querySelector(`input[name=_csrf_token]`) as HTMLInputElement).value,
	);
	const phpSessionId = (await dom.cookieJar.getCookies(dom.window.location.href)).find(x =>
		x.key == "PHPSESSID"
	);
	if (!phpSessionId) throw new Error("no php session id");
	const sessionId = phpSessionId.value;
	form.append("_username", user);
	form.append("_password", pass);
	const resp = await fetch(new URL("/login", process.env["CONTEST_URL"]).href, {
		method: "POST",
		body: form,
	});
	if (!resp.ok) throw new Error("failed to login to domjudge");
}

const feed = client.feed("teamFeed", { id: data.teamId });
for await (const event of feed) {
	event.state.domJudgeCredentials;
}

if (data.configuredBrowser == null) {
}

// client.feed("teamFeed", {  })
