#! tsx

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { kill } from "node:process";
import readline from "node:readline";
import { Readable, Writable } from "node:stream";
import { parseArgs, styleText } from "node:util";

const dispose = new DisposableStack();

function err(...msg: string[]): never {
	console.error(styleText(["redBright", "bold"], msg[0]));
	msg.slice(1).forEach(v => console.log(styleText("yellowBright", v)));
	dispose.dispose();
	process.exit(1);
}

function gray(msg: string) {
	console.log(styleText("black", msg));
}

const logExec = (cmd: string, args: string[]) =>
	gray(`executing ${cmd} ${args.map(v => `"${v.replaceAll("\"", "\\\"")}"`).join(" ")}`);

async function exec(cmd: string, args: string[]) {
	logExec(cmd, args);
	const proc = spawn(cmd, args, { stdio: "inherit" });
	const timeout = new Promise<void>(res => setTimeout(res, 30_000)).then(() => "timeout" as const);
	const error = new Promise<Error>(res => proc.once("error", err => res(err)));
	const exitCode = new Promise<number | null>(res => proc.once("exit", code => res(code)));
	const d = await Promise.race([timeout, exitCode, error]);
	if (d == "timeout") {
		err(`${cmd} timed out`);
	} else if (d instanceof Error) {
		err(`error spawning ${cmd}`, d.message);
	} else if (d != 0) {
		err(`${cmd} exited with code ${d ?? "(aborted)"}`);
	}
}

async function detectJavaMainClass(file: string): Promise<string> {
	const src = await readFile(file, "utf-8");
	const classMatch = src.match(/\bpublic\s+(?:final|sealed|abstract\s+)?class\s+([A-Z]\w*)/);
	const className = classMatch?.[1] ?? basename(file).replace(/\.java$/i, "");
	return className;
}

function kotlinMainClass(file: string): string {
	const base = basename(file).replace(/\.kt$/i, "");
	const underscored = base.split(" ").join("_");
	return `${underscored[0].toUpperCase()}${underscored.slice(1)}Kt`;
}

const home = process.env["HOME"]!;
if (!existsSync(home)) err("home directory not found");

const runTmpDir = join(home, "run-tmp");

await mkdir(runTmpDir, { recursive: true });
async function withTmp<T>(name: string, f: (dir: string) => Promise<T>): Promise<T> {
	const path = join(runTmpDir, name);
	await mkdir(path, { recursive: true });
	let rmed = false;
	dispose.defer(() => {
		// 🤡
		// why did i use exit(1)
		if (!rmed) rmSync(path, { recursive: true, force: true });
	});
	try {
		return await f(path);
	} finally {
		await rm(path, { recursive: true, force: true });
		rmed = true;
	}
}

export const languages = [
	// C
	{
		name: "c",
		domJudgeId: "c",
		exts: ["c"],
		async compile(file: string, out: string) {
			await exec("gcc", ["-x", "c", "-Wall", "-O2", "-pipe", "-o", out, file, "-lm"]);
		},
		async run(out: string) {
			return [out];
		},
	},

	// C++
	{
		name: "cpp",
		domJudgeId: "cpp",
		exts: ["cpp", "cc", "cxx"],
		async compile(file: string, out: string) {
			await exec("g++", ["-x", "c++", "-std=gnu++23", "-Wall", "-O2", "-o", out, file]);
		},
		async run(out: string) {
			return [out];
		},
	},

	// Rust
	{
		name: "rust",
		domJudgeId: "rs",
		exts: ["rs"],
		async compile(file: string, out: string) {
			await exec("rustc", ["-C", "opt-level=3", "-o", out, file]);
		},
		async run(out: string) {
			return [out];
		},
	},

	// Zig
	{
		name: "zig",
		domJudgeId: "zig",
		exts: ["zig"],
		async compile(file: string, out: string) {
			await exec("zig", ["build-exe", file, "-O", "ReleaseFast", `-femit-bin=${out}`]);
		},
		async run(out: string) {
			return [out];
		},
	},

	// JavaScript
	{
		name: "javascript",
		domJudgeId: "js",
		exts: ["js"],
		async run(file: string) {
			return ["node", file];
		},
	},

	// TypeScript → single JS next to `out`
	{
		name: "typescript",
		domJudgeId: "tsx",
		exts: ["ts", "tsx"],
		compiledExt: "js",
		async compile(file: string, out: string) {
			await withTmp("ts-tmp", async dir => {
				await exec("tsc", [
					"-t",
					"esnext",
					"-m",
					"commonjs",
					"--pretty",
					"false",
					"--typeRoots",
					"/usr/local/lib/node_modules/@types",
					"--outDir",
					dir,
					file,
				]);

				const jsFrom = join(dir, `${basename(file, extname(file))}.js`);
				const jsTo = out;
				await rename(jsFrom, jsTo);
			});
		},
		async run(out: string) {
			return ["node", out];
		},
	},

	{
		name: "java",
		domJudgeId: "java",
		exts: ["java"],
		compiledExt: "jar",
		async compile(file: string, out: string) {
			await withTmp("java-classes", async dir => {
				// 1) compile classes into a temp classes dir
				await exec("javac", ["-d", dir, file]);

				// 2) detect main class
				const mainClass = await detectJavaMainClass(file);

				// 3) pack into a runnable JAR at out
				// jar cfe <jar> <MainClass> -C <dir> .
				await exec("jar", ["cfe", out, mainClass, "-C", dir, "."]);
			});
		},
		async run(out: string) {
			return ["java", "-Dfile.encoding=UTF-8", "-XX:+UseSerialGC", "-jar", out];
		},
	},

	// Kotlin → JAR at `out.jar`
	{
		name: "kotlin",
		domJudgeId: "kt",
		exts: ["kt"],
		compiledExt: "jar",
		async compile(file: string, out: string) {
			await withTmp("kotlin-classes", async dir => {
				await exec("kotlinc", [file, "-d", dir]);
				await exec("jar", ["cf", out, "-C", dir, "."]);
			});
		},
		async run(out: string, src: string) {
			return ["kotlin", "-classpath", out, kotlinMainClass(src)];
		},
	},
	{
		name: "python",
		domJudgeId: "py3",
		exts: ["py"],
		async run(file: string) {
			return ["pypy3", file];
		},
	},
] as const;

const cpp = languages.find(v => v.name == "cpp")!;

type Language = (typeof languages)[number];

async function compile(language: Language, file: string) {
	if (!("compile" in language)) return file;

	let cache: Record<string, string> = {};
	const cachePath = join(runTmpDir, "cache.json");
	if (existsSync(cachePath)) {
		cache = JSON.parse(await readFile(cachePath, "utf-8")) as unknown as typeof cache;
	}

	const h = createHash("SHA-256");
	const name = basename(file, extname(file));
	let outPath = join(runTmpDir, name);
	if ("compiledExt" in language) outPath += `.${language.compiledExt satisfies string}`;
	h.update(resolve(file));
	h.update(await readFile(file));
	const hash = h.digest().toString("hex");

	if (cache[name] == hash && existsSync(outPath)) return outPath;

	await language.compile(file, outPath);

	cache[name] = hash;
	await writeFile(cachePath, JSON.stringify(cache));
	return outPath;
}

// this is actually copied from my vscode extension 🤡
type Program = {
	exitCode: number | null;
	pid: number | null;
	closed: boolean;
	closePromise: Promise<void>;
	spawnPromise: Promise<number>;
	stdin: Writable;
	stdout: Readable;
} & Disposable;

type ProgramStartOpts = {
	prog: string;
	cwd?: string;
	args?: string[];
	stdin?: string;
	stdout?: string;
	inheritStdio?: boolean;
};

function attachError(
	x: { once: (type: "error", listener: (e: Error) => void) => void },
	msg: string,
) {
	x.once("error", e => err(msg, e.message));
}

async function startChildProgram(
	{ prog, stdin, stdout, cwd, args, inheritStdio }: ProgramStartOpts,
): Promise<Program> {
	logExec(prog, args ?? []);
	const cp = spawn(prog, args, { cwd });

	attachError(cp, `Failed to start program ${prog}`);

	const o: Omit<Program & { handle: () => number }, "spawnPromise"> & {
		spawnPromise?: Program["spawnPromise"];
	} = {
		handle() {
			if (o.closed && cp.pid != undefined) {
				kill(cp.pid);
				err("Process killed before spawning");
			}

			if (cp.pid != undefined) o.pid = cp.pid;
			else err("PID of process not set");

			if (stdout != null) {
				const write = createWriteStream(stdout);
				attachError(write, "Failed to open output file");
				cp.stdout.pipe(write);
			}

			if (inheritStdio == true) {
				cp.stdout.pipe(process.stdout);
				cp.stderr.pipe(process.stderr);
			}

			if (stdin != null) {
				const inp = createReadStream(stdin, "utf-8");
				attachError(inp, "Failed to open input file");
				inp.pipe(cp.stdin, { end: true });
			}
			return cp.pid;
		},
		exitCode: null,
		closed: false,
		pid: null,
		stdin: cp.stdin,
		stdout: cp.stdout,
		[Symbol.dispose]() {
			if (!this.closed && this.pid != null && !kill(this.pid)) {
				err("Failed to kill process");
			}
			this.closed = true;
		},
		closePromise: new Promise(res => cp.once("close", v => {
			o.closed = true;
			o.exitCode = v ?? cp.exitCode;
			res();
		})),
	};

	const launched = cp.pid == null || cp.stdout == null || cp.stderr == null;
	o.spawnPromise = !launched
		? new Promise(res => {
			cp.once("spawn", () => res(o.handle()));
		})
		: Promise.resolve(o.handle());

	return o as Program;
}

async function check(
	inputFile: string,
	answerFile: string,
	outputFile: string,
	problemPath: string,
) {
	let checkerPath = join(problemPath, "checker.cpp");
	if (!existsSync(checkerPath)) checkerPath = join(import.meta.dirname, "compare.cpp");

	const checkerFlagsPath = join(problemPath, "checker_flags.txt");
	const checkerFlags = existsSync(checkerFlagsPath)
		? (await readFile(checkerFlagsPath, "utf-8")).split(" ")
		: [];

	const checkerOut = await compile(cpp, checkerPath);

	await withTmp("feedback-dir", async dir => {
		const res = dispose.use(
			await startChildProgram({
				prog: checkerOut,
				args: [inputFile, answerFile, dir, ...checkerFlags],
				stdin: outputFile,
				inheritStdio: false,
			}),
		);

		await res.spawnPromise;
		await res.closePromise;

		const ac = res.exitCode == 42;
		if (!ac) {
			const msg = await readFile(join(dir, "judgemessage.txt"), "utf-8");
			return err(`checker exited with code ${res.exitCode}`, msg);
		}
	});
}

async function promptSubmit(language: Language, label: string, file: string) {
	const rl = readline.createInterface(process.stdin, process.stdout);
	const ans = await new Promise<string>(res => rl.question("submit? (y/n) ", res));
	rl.close();

	if (ans.toLowerCase().trim().startsWith("y")) {
		gray("submitting...");
		await exec("submit", ["-y", "-p", label, "-l", language.domJudgeId, file]);
	}
}

type Problem = { path: string; label: string };

async function run(
	language: Language,
	problem: Problem | null,
	out: string,
	sourceFile: string,
	args: string[],
) {
	let cmd: string[];
	if ("run" in language) {
		cmd = await language.run(out, sourceFile);
	} else {
		cmd = [out];
	}

	if (problem == null) {
		await exec(cmd[0], [...cmd.slice(1), ...args]);
		gray(`${out} exited with code 0`);
		return;
	}

	const samples = [
		...new Set(
			(await readdir(problem.path)).map(v => {
				const m = v.match(/^(\d+)\.(ans|in)$/);
				if (!m) return null;
				const testI = Number.parseInt(m[1]);
				if (!isFinite(testI)) return null;
				return testI;
			}).filter(x => x != null),
		),
	].sort((a, b) => a-b);

	await withTmp("run", async dir => {
		for (const samp of samples) {
			console.log(styleText(["bold", "whiteBright"], `running sample ${samp}`));
			const sampIn = join(problem.path, `${samp}.in`);
			const sampAns = join(problem.path, `${samp}.ans`);
			const output = join(dir, `${samp}-output.txt`);

			for (const line of (await readFile(sampIn, "utf-8")).split("\n")) {
				console.log(styleText(["gray", "italic"], `> ${line}`));
			}

			const prog = await startChildProgram({
				prog: cmd[0],
				args: [...cmd.slice(1), ...args],
				stdin: sampIn,
				stdout: output,
				inheritStdio: true,
			});

			await prog.spawnPromise;
			await prog.closePromise;

			if (prog.exitCode != 0) {
				return err(`${out} exited with code ${prog.exitCode}`);
			}

			gray("running checker...");
			await check(sampIn, sampAns, output, problem.path);
			console.log(styleText(["green", "bold"], `sample ${samp} ok`));
		}
	});

	console.log(styleText(["green", "bold"], `all ${samples.length} samples ok`));
	await promptSubmit(language, problem.label, sourceFile);
}

async function main() {
	const defaultDirs = [join(home, "problems"), join(home, "practice")];

	const { positionals, values: opts } = parseArgs({
		options: {
			language: { type: "string", short: "l" },
			problem: { type: "string", short: "p" },
			path: {
				type: "string",
				default: (await Promise.all(defaultDirs.map(async v =>
					[
						v,
						// make sure it exists and we can descend
						await readdir(v).catch(() => false) != false,
					] as const
				))).find(v => v[1])?.[0],
			},
			help: { type: "boolean", short: "h" },
		},
		strict: true,
		allowPositionals: true,
	});

	if (opts.help == true) {
		console.log(`
Usage: run.ts [options] <source-file> [args...]

Options:
  -l, --language <name>   Specify language explicitly (${languages.map(v => v.name).join(", ")})
  -p, --problem <label>   Run against problem samples with this label
  --path <dir>            Root directory for problems (defaults to ~/problems or ~/practice)
  -h, --help              Show this help message and exit

Examples:
  run.ts solution.cpp
  run.ts -p a -l cpp my_solution.cpp
  run.ts --language=python script.py

Description:
  Compiles (if needed) and runs the given source file. If a problem label is provided,
  the program will automatically run against all sample inputs in the matching problem folder,
  check outputs using the problem's checker, and prompt for submission if samples pass.
`.trim());
		process.exit(0);
	}

	if (positionals.length < 1) {
		err("expected at least one argument -- the source file to run");
	}

	if (!existsSync(positionals[0])) {
		err(`file ${positionals[0]} doesn't exist`);
	}

	let problem: Problem | null = null;
	if (opts.problem != undefined) {
		if (opts.path == undefined) err("no problems path found or provided");
		const prob = opts.problem.toLowerCase();
		const name = (await readdir(opts.path, { withFileTypes: true })).map(ent => {
			if (!ent.isDirectory()) return null;
			const r = ent.name.split("-");
			if (r.length < 2) return null;
			return [r[0], r.slice(1).join("-"), ent.name];
		}).find(v => {
			return v != null && v.some(u => u == prob);
		});
		if (name == null) err(`nothing matching ${opts.problem} found in ${opts.path}`);
		const problemPath = join(opts.path, name[2]);
		problem = { path: problemPath, label: name[0] };
		gray(`using samples in ${problemPath} (problem ${name[0].toUpperCase()})`);
	}

	let lang: Language | undefined;
	if (opts.language != undefined) {
		lang = languages.find(v => v.name == opts.language);
	} else {
		let ext = extname(positionals[0]);
		if (ext.startsWith(".")) ext = ext.slice(1);
		lang = languages.find(v => (v.exts as readonly string[]).includes(ext));
	}

	if (lang == undefined) {
		err(
			"language not found. pass a language explicitly with -language / -l",
			`supported languages: ${languages.map(v => v.name).join(", ")}`,
		);
	}

	const out = await compile(lang, positionals[0]);
	await run(lang, problem, out, positionals[0], positionals.slice(1));
	process.exit(0);
}

await main();
