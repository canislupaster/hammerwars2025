import { SendEmailCommand } from "@aws-sdk/client-ses";
import { Hono } from "hono";
import { Buffer } from "node:buffer";
import { randomInt, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import z from "zod";
import { randomShirtSeed } from "../shared/genshirt.ts";
import { API, ContestProperties, DOMJudgeActiveContest, fill, getTeamLogoURL, logoMaxSize,
	maxPromptLength, resumeMaxSize, screenshotMaxWidth, shirtSizes, TeamContestProperties, teamLimit,
	UserInfo, validDiscordRe, validNameRe } from "../shared/util.ts";
import { DBTransaction, EventEmitter, getDb, getDbCheck, getProperties, getProperty,
	propertiesChanged, setDb, setProperty, transaction, updateDb, UserData } from "./db.ts";
import { domJudge } from "./domjudge.ts";
import { makeVerificationEmail } from "./email.ts";
import { auth, Context, env, err, genKey, getKey, HonoEnv, keyAuth, makeRoute, matchKey, openai,
	rootUrl, sesClient } from "./main.ts";

const passwordSchema = z.string().min(8).max(100);
const nameSchema = z.string().regex(new RegExp(validNameRe));
const inPersonSchema = z.object({
	needTransportation: z.boolean(),
	pizza: z.enum(["cheese", "pepperoni", "sausage", "none"]),
	sandwich: z.enum([
		"chickenBaconRancher",
		"chipotleChickenAvoMelt",
		"toastedGardenCaprese",
		"baconTurkeyBravo",
		"none",
	]),
	shirtSize: z.enum(shirtSizes),
});
const discordSchema = z.string().regex(new RegExp(validDiscordRe));
const userInfoSchema = z.object({
	name: nameSchema,
	discord: discordSchema.nullable(),
	inPerson: inPersonSchema.nullable(),
	shirtSeed: z.int32(),
	shirtHue: z.number().min(0).max(360),
});
const partialUserInfoSchema = z.object({
	name: nameSchema.optional(),
	discord: discordSchema.nullable(),
	inPerson: inPersonSchema.partial().and(z.object({ needTransportation: z.boolean() })).nullable(),
	shirtSeed: z.int32(),
	shirtHue: z.number().min(0).max(360),
	agreeRules: z.boolean(),
});

export async function makeRoutes(app: Hono<HonoEnv>) {
	const teamChanged = new EventEmitter<number>();

	makeRoute(app, "register", {
		validator: z.object({ email: z.email() }),
		ratelimit: { durationMs: 3600*1000*24, times: 5 },
		handler: async (_c, req) => {
			const verifyKey = genKey();
			const newId = await transaction(async trx => {
				const exists = await trx.selectFrom("emailVerification").selectAll().where(
					"email",
					"=",
					req.email,
				).executeTakeFirst();
				if (exists) return null;

				return (await trx.insertInto("emailVerification").returning("id").values({
					email: req.email,
					key: verifyKey,
				}).executeTakeFirstOrThrow()).id;
			});

			if (newId != null) {
				const url = new URL("/verify", rootUrl);
				url.searchParams.append("id", newId.toString());
				url.searchParams.append("key", verifyKey.toString("hex"));

				if (env["NOSEND_EMAIL"] == "1") {
					console.log(`${req.email} verification link: ${url.href}`);
				} else {
					const response = await sesClient.send(
						new SendEmailCommand({
							Destination: { ToAddresses: [req.email], CcAddresses: [], BccAddresses: [] },
							Source: "noreply@email.purduecpu.com",
							Message: {
								Subject: {
									Charset: "UTF-8",
									Data: "HammerWars 2025: Finish setting up your account",
								},
								Body: { Html: { Charset: "UTF-8", Data: makeVerificationEmail(url.href) } },
							},
						}),
					);

					console.log(`sent to ${req.email} (id ${response.MessageId})`);
				}
			}

			return newId == null ? "alreadySent" : "sent";
		},
	});

	makeRoute(app, "checkEmailVerify", {
		validator: z.object({ id: z.number(), key: z.hex() }),
		handler: async (_c, req) => {
			return await transaction(async trx => {
				const verify = await getDb(trx, "emailVerification", req.id);
				return verify != null && timingSafeEqual(verify.key, Buffer.from(req.key, "hex"));
			});
		},
	});

	async function makeSession(c: Context, trx: DBTransaction, userId: number) {
		const sesKey = genKey();
		const sesId = await setDb(trx, "session", null, {
			user: userId,
			created: Date.now(),
			key: sesKey,
		});

		c.set("session", { id: sesId, key: sesKey.toString("hex") });
	}

	function removeSession(c: Context) {
		c.set("session", "clear");
	}

	makeRoute(app, "createAccount", {
		validator: z.object({ id: z.number(), key: z.hex(), password: passwordSchema }),
		handler: async (c, req) => {
			return await transaction(async trx => {
				const row = await trx.selectFrom("emailVerification").selectAll().where("id", "==", req.id)
					.executeTakeFirst();
				if (row == null || !timingSafeEqual(row.key, Buffer.from(req.key, "hex"))) {
					throw err("Invalid verification key");
				}

				const prevUser = await trx.selectFrom("user").select("id").where("email", "=", row.email)
					.executeTakeFirst();

				let userId: number;
				const passwordHash = await getKey(req.password);
				if (prevUser) {
					await updateDb(
						trx,
						"user",
						prevUser.id,
						async o => ({ ...o, data: { ...o.data, passwordHash } }),
					);
					userId = prevUser.id;
				} else {
					const data: UserData = {
						info: {
							inPerson: null,
							discord: null,
							shirtSeed: randomShirtSeed(),
							shirtHue: 0,
							agreeRules: false,
						},
						submitted: null,
						lastEdited: Date.now(),
						passwordHash,
					};
					userId = await setDb(trx, "user", null, { email: row.email, team: null, data });
				}

				await makeSession(c, trx, userId);
			});
		},
	});

	makeRoute(app, "login", {
		validator: z.object({ email: z.email(), password: passwordSchema }),
		ratelimit: { times: 5, durationMs: 5000 },
		handler: async (c, req) => {
			return await transaction(async trx => {
				const row = await trx.selectFrom("user").select("id").where("email", "=", req.email)
					.executeTakeFirst();
				if (!row) return "incorrect";
				const u = await getDbCheck(trx, "user", row.id);
				if (!await matchKey(u.data.passwordHash, req.password)) return "incorrect";
				await makeSession(c, trx, row.id);
				return null;
			});
		},
	});

	makeRoute(app, "setPassword", {
		validator: z.object({ newPassword: passwordSchema }),
		handler: async (c, req) => {
			const userId = await auth(c);
			const salt = genKey();
			return await transaction(async trx => {
				await updateDb(
					trx,
					"user",
					userId,
					async old => ({
						...old,
						data: { ...old.data, passwordHash: await getKey(req.newPassword), passwordSalt: salt },
					}),
				);

				await trx.deleteFrom("session").where("user", "=", userId).execute();
				await makeSession(c, trx, userId);
			});
		},
	});

	makeRoute(app, "checkSession", {
		handler: async c => {
			await auth(c);
		},
	});

	makeRoute(app, "updateResume", {
		validator: z.object({ type: z.literal("add"), base64: z.base64() }).or(
			z.object({ type: z.literal("remove") }),
		),
		async handler(c, req) {
			const userId = await auth(c);
			await transaction(async trx => {
				if ((await getDbCheck(trx, "user", userId)).data.submitted != null) {
					throw err("You must unsubmit to modify your resume");
				}

				if (req.type == "add") {
					const resume = Buffer.from(req.base64, "base64");
					if (resume.byteLength > resumeMaxSize) {
						throw err("resume is too large");
					}
					await trx.insertInto("resume").values({ user: userId, file: resume }).onConflict(c =>
						c.doUpdateSet({ file: resume })
					).execute();
				} else if (req.type == "remove") {
					await trx.deleteFrom("resume").where("user", "=", userId).execute();
				}
			});
		},
	});

	const checkRegistrationOpen = async (trx: DBTransaction) => {
		if (await getProperty(trx, "registrationOpen") != true) {
			throw err("Registration is not open");
		}
		const ends = await getProperty(trx, "registrationEnds");
		if (ends != null && Date.now() >= ends) {
			throw err("Registration has ended");
		}
	};

	makeRoute(app, "updateInfo", {
		validator: z.object({
			info: partialUserInfoSchema,
			resume: z.object({ type: z.literal("add"), base64: z.base64() }).or(
				z.object({ type: z.literal("remove") }),
			).optional(),
			submit: z.boolean(),
		}),
		handler: async (c, req) => {
			const userId = await auth(c);
			await transaction(async trx =>
				updateDb(trx, "user", userId, async old => {
					if (old.data.submitted && req.submit) {
						throw err("You must unsubmit to update your information");
					}

					let submitted: UserInfo | null = null;
					if (req.submit) {
						await checkRegistrationOpen(trx);
						const parsed = userInfoSchema.safeParse(req.info);
						if (!parsed.success) throw err("Can't submit: not fully filled out");
						if (parsed.data.inPerson) {
							const hasResume = await trx.selectFrom("resume").where("user", "=", userId).select(
								"id",
							).executeTakeFirst();
							if (hasResume == undefined) {
								throw err("Can't submit: no resume provided for in-person participant");
							}
						} else if (!req.info.agreeRules) {
							throw new Error("rules not agreed to");
						}
						submitted = parsed.data;
					}

					return {
						...old,
						data: { ...old.data, info: req.info, submitted, lastEdited: Date.now() },
					};
				})
			);
			domJudge.updateTeams();
		},
	});

	makeRoute(app, "deleteUser", {
		handler: async c => {
			const userId = await auth(c);
			await transaction(trx => setDb(trx, "user", userId, null));
			removeSession(c);
		},
	});

	async function setTeamLogo(trx: DBTransaction, team: number, logo: Buffer, _logoMime: string) {
		// dont upsert so id changes
		await trx.deleteFrom("teamLogo").where("team", "=", team).execute();
		const img = sharp(logo);
		const meta = await img.metadata();
		const len = Math.max(meta.width, meta.height);
		const nlogo = await (img.png().resize(len, len, { fit: "contain", background: "transparent" }))
			.toBuffer();
		await trx.insertInto("teamLogo").values({ logo: nlogo, logoMime: "image/png", team }).execute();
	}

	makeRoute(app, "setTeam", {
		validator: z.object({
			name: nameSchema,
			logo: z.object({ base64: z.base64(), mime: z.enum(["image/png", "image/jpeg"]) }).nullable()
				.or(z.literal("remove")),
		}),
		handler: async (c, req) => {
			const userId = await auth(c);
			await transaction(async trx => {
				await checkRegistrationOpen(trx);
				const u = await getDb(trx, "user", userId);
				if (u == null) throw err("user does not exist");

				let teamId: number;
				if (u.team != null) {
					teamId = u.team;
					await setDb(trx, "team", u.team, { name: req.name });
				} else {
					teamId = await setDb(trx, "team", null, {
						joinCode: fill(10, () => randomInt(0, 9).toString()).join(""),
						name: req.name,
					});

					await setDb(trx, "user", userId, { team: teamId });
				}

				if (req.logo == "remove") {
					await trx.deleteFrom("teamLogo").where("team", "=", teamId).execute();
				} else if (req.logo != null) {
					const logo = Buffer.from(req.logo.base64, "base64");
					if (logo.byteLength > logoMaxSize) {
						throw err(`team logo is too large`);
					}
					await setTeamLogo(trx, teamId, logo, req.logo.mime);
				}
			});
			domJudge.updateTeams();
		},
	});

	makeRoute(app, "joinTeam", {
		validator: z.object({ joinCode: z.string() }),
		ratelimit: { times: 5, durationMs: 5000 },
		handler: async (c, req) => {
			const userId = await auth(c);
			const ret = await transaction(async trx => {
				await checkRegistrationOpen(trx);
				if ((await getDbCheck(trx, "user", userId)).team != null) {
					throw err("You need to leave your team first");
				}
				const team = await trx.selectFrom("team").selectAll().where("joinCode", "==", req.joinCode)
					.executeTakeFirst();
				if (!team) throw err("Invalid join code.");
				if ((await getMembers(trx, team.id)).length+1 > teamLimit) {
					return { full: true };
				}
				await setDb(trx, "user", userId, { team: team.id });
				return { full: false };
			});
			domJudge.updateTeams();
			return ret;
		},
	});

	makeRoute(app, "leaveTeam", {
		handler: async c => {
			const userId = await auth(c);
			await transaction(async trx => {
				await checkRegistrationOpen(trx);
				const u = await getDb(trx, "user", userId);
				if (u?.team == null) throw err("User is not in a team");
				await setDb(trx, "user", userId, { team: null });
				const count = await trx.selectFrom("user").select(s => s.fn.countAll<number>().as("count"))
					.where("team", "=", u.team).executeTakeFirstOrThrow();
				if (count.count == 0) await setDb(trx, "team", u.team, null);
			});
			domJudge.updateTeams();
		},
	});

	const getMembers = async (trx: DBTransaction, teamId: number) => {
		return await Promise.all(
			(await trx.selectFrom("user").select("id").where("team", "=", teamId).execute()).map(v =>
				getDbCheck(trx, "user", v.id)
			),
		);
	};

	makeRoute(app, "getInfo", {
		handler: async c => {
			const userId = await auth(c);
			return await transaction(async trx => {
				const { data, team } = await getDbCheck(trx, "user", userId);
				const resume = await trx.selectFrom("resume").select("id").where("user", "=", userId)
					.executeTakeFirst();
				const data2 = {
					info: data.info,
					submitted: data.submitted != null,
					lastEdited: data.lastEdited,
					hasResume: resume != undefined,
				};

				if (team != null) {
					const teamData = await getDbCheck(trx, "team", team);
					const logo = await trx.selectFrom("teamLogo").select("teamLogo.id").where(
						"team",
						"=",
						team,
					).executeTakeFirst();
					return {
						...data2,
						team: {
							logo: logo != null ? getTeamLogoURL(logo.id) : null,
							joinCode: teamData.joinCode,
							name: teamData.name,
							members: (await getMembers(trx, team)).map(v => ({
								email: v.email,
								name: v.data.info.name ?? null,
								id: v.id,
								inPerson: v.data.submitted ? v.data.submitted.inPerson != null : null,
							})),
						},
					};
				}

				return { ...data2, team: null };
			});
		},
	});

	makeRoute(app, "registrationWindow", {
		async handler(_c) {
			return await transaction(async trx => ({
				open: await getProperty(trx, "registrationOpen") ?? false,
				closes: await getProperty(trx, "registrationEnds"),
			}));
		},
	});

	makeRoute(app, "getProperties", {
		async handler(c) {
			await keyAuth(c, true);
			return await transaction(trx => getProperties(trx));
		},
	});

	makeRoute(app, "setProperties", {
		validator: z.object({
			registrationEnds: z.number().nullable(),
			registrationOpen: z.boolean(),
			domJudgeCid: z.string(),
			team: z.object({
				firewallEnabled: z.boolean(),
				screenshotsEnabled: z.boolean(),
				visibleDirectories: z.string().array(),
			}),
		}).partial().strip(),
		async handler(c, req) {
			await keyAuth(c, true);
			await transaction(async trx => {
				// zod strips unknown keys
				for (const k in req) {
					const contestKey = k as keyof ContestProperties;
					// null !== undefined
					if (req[contestKey] !== undefined) {
						await setProperty(trx, contestKey, req[contestKey]);
					}
				}
			});
		},
	});

	makeRoute(app, "getResume", {
		async handler(c) {
			const uid = await auth(c);
			const resumeData = await transaction(trx =>
				trx.selectFrom("resume").where("user", "=", uid).select("file").executeTakeFirst()
			);
			if (!resumeData) throw err("Resume not uploaded");
			// 💀 im so sorry
			return resumeData.file.toString("base64");
		},
	});

	makeRoute(app, "generateLogo", {
		validator: z.object({ prompt: z.string().max(maxPromptLength) }),
		ratelimit: { times: 5, durationMs: 3600*1000 },
		async handler(c, req) {
			const userId = await auth(c);
			const [teamId, teamName] = await transaction(async trx => {
				await checkRegistrationOpen(trx);
				const teamId = (await getDbCheck(trx, "user", userId)).team;
				if (teamId == null) throw err("user not in a team");
				return [teamId, (await getDbCheck(trx, "team", teamId)).name] as const;
			});
			const res = await openai.images.generate({
				model: "gpt-image-1",
				prompt:
					`Create a team logo for a programming contest for a team named "${teamName}. It should work well on a black background. ${req.prompt}`,
				quality: "medium",
				output_format: "png",
			});
			const data = res.data?.[0]?.b64_json;
			if (data == null) throw err("Image was not generated");
			const logo = Buffer.from(data, "base64");
			await transaction(trx => setTeamLogo(trx, teamId, logo, "image/png"));
		},
	});

	app.get("/teamLogo/:id", async c => {
		const id = c.req.param().id;
		const idInt = Number.parseInt(id);
		if (!isFinite(idInt)) throw err("invalid id");
		const data = await transaction(trx => getDbCheck(trx, "teamLogo", idInt));
		return c.body(new Uint8Array(data.logo), 200, { "Content-Type": data.logoMime });
	});

	const toAdminTeam = async (trx: DBTransaction, id: number) => {
		const team = await getDbCheck(trx, "team", id);
		const logo = await trx.selectFrom("teamLogo").select("id").where("team", "=", team.id)
			.executeTakeFirst();
		return {
			id: team.id,
			name: team.name,
			logoId: logo?.id ?? null,
			domJudgeId: team.domJudgeId,
			domJudgePassword: team.domJudgePassword,
			joinCode: team.joinCode,
		};
	};

	makeRoute(app, "allData", {
		async handler(c) {
			await keyAuth(c, true);
			return await transaction(async trx => {
				const out: API["allData"]["response"] = { users: [], teams: [] };
				for (const { id } of await trx.selectFrom("user").select("id").execute()) {
					const udata = await getDbCheck(trx, "user", id);
					const resume = await trx.selectFrom("resume").select("id").where("user", "=", id)
						.executeTakeFirst();
					out.users.push({
						id,
						email: udata.email,
						data: udata.data.submitted,
						team: udata.team,
						resumeId: resume?.id ?? null,
					});
				}
				for (const team of await trx.selectFrom("team").select("id").execute()) {
					out.teams.push(await toAdminTeam(trx, team.id));
				}
				return out;
			});
		},
	});

	makeRoute(app, "setTeams", {
		validator: z.array(
			z.object({
				id: z.number(),
				name: nameSchema,
				domJudgeId: z.string().nullable(),
				domJudgePassword: z.string().nullable(),
				joinCode: z.string(),
			}).or(z.object({ id: z.number(), delete: z.literal(true) })),
		),
		async handler(c, req) {
			await keyAuth(c, true);
			await transaction(async trx => {
				for (const team of req) {
					if ("delete" in team) {
						await setDb(trx, "team", team.id, null);
						continue;
					}

					await setDb(trx, "team", team.id, {
						name: team.name,
						joinCode: team.joinCode,
						domJudgeId: team.domJudgeId,
						domJudgePassword: team.domJudgePassword,
					});

					teamChanged.emit(team.id);
				}
			});
			domJudge.updateTeams();
		},
	});

	makeRoute(app, "getResumeId", {
		validator: z.object({ id: z.number() }),
		async handler(c, { id }) {
			await keyAuth(c, true);
			const { file } = await transaction(trx =>
				trx.selectFrom("resume").select("file").where("id", "=", id).executeTakeFirstOrThrow()
			);
			return { base64: file.toString("base64") };
		},
	});

	makeRoute(app, "getTeamLogo", {
		validator: z.object({ id: z.number() }),
		async handler(c, { id }) {
			await keyAuth(c, true);
			const { logo, logoMime } = await transaction(trx =>
				trx.selectFrom("teamLogo").selectAll().where("id", "=", id).executeTakeFirstOrThrow()
			);
			return { base64: logo.toString("base64"), mime: logoMime };
		},
	});

	makeRoute(app, "scoreboard", {
		feed: true,
		handler: async function* handler(api) {
			yield domJudge.scoreboard.v;
			const abort = new AbortController();
			api.onAbort(() => abort.abort());
			while (!abort.signal.aborted) {
				const sc = await domJudge.scoreboard.change.wait(abort.signal);
				if (sc == null) return;
				yield sc;
			}
		},
	});

	makeRoute(app, "teamFeed", {
		feed: true,
		validator: z.object({ id: z.int() }),
		handler: async function* handler(api, c, { id }) {
			await keyAuth(c, false);

			const getCred = async () => {
				const team = await transaction(trx => getDbCheck(trx, "team", id));
				const domJudgeUser = team.domJudgeId != null
					? domJudge.getTeamUsername(team.domJudgeId)
					: null;
				return domJudgeUser != null && team.domJudgePassword != null
					? { user: domJudgeUser, pass: team.domJudgePassword }
					: null;
			};

			type Update = { type: "cred" } | { type: "active"; active: DOMJudgeActiveContest } | {
				type: "props";
				props: TeamContestProperties;
			};

			const emitter = new EventEmitter<Update>();

			this.use(teamChanged.on(v => {
				if (v == id) emitter.emit({ type: "cred" });
			}));

			this.use(domJudge.activeContest.change.on(v => emitter.emit({ type: "active", active: v })));

			const defaultTeamProps: TeamContestProperties = {
				firewallEnabled: false,
				screenshotsEnabled: false,
				visibleDirectories: [],
			};

			this.use(propertiesChanged.on(c => {
				emitter.emit({ type: "props", props: c.team ?? defaultTeamProps });
			}));

			const abort = new AbortController();
			api.onAbort(() => abort.abort());

			const queue: (typeof emitter extends EventEmitter<infer T> ? T : never)[] = [];

			// if i just wait there's a race thing which is really dumb
			this.use(emitter.on(update => queue.push(update)));
			const state = {
				domJudgeCredentials: await getCred(),
				domJudgeActiveContest: domJudge.activeContest.v,
				teamProperties: (await transaction(trx => getProperties(trx))).team ?? defaultTeamProps,
			};

			while (!abort.signal.aborted) {
				yield { type: "update", state };
				const ev = queue.pop();
				if (ev == undefined) {
					await emitter.wait();
					continue;
				}
				if (ev.type == "cred") state.domJudgeCredentials = await getCred();
				else if (ev.type == "active") state.domJudgeActiveContest = ev.active;
				else state.teamProperties = ev.props;
			}
		},
	});

	const screenshotPath = env.SCREENSHOT_PATH;
	if (screenshotPath != undefined && !(await stat(screenshotPath)).isDirectory()) {
		throw new Error("screenshot path should be a directory");
	}

	makeRoute(app, "screenshot", {
		validator: z.object({ team: z.number(), mac: z.string(), data: z.base64() }),
		async handler(c, { team, data, mac }) {
			await keyAuth(c, false);
			if (screenshotPath == undefined) return;
			const t = Date.now();
			const path = join(screenshotPath, `${team}-${t}.avif`);
			await sharp(Buffer.from(data, "base64")).resize(screenshotMaxWidth, null, {
				withoutEnlargement: true,
			}).heif({ compression: "av1" }).toFile(path);
			await transaction(trx => setDb(trx, "teamScreenshot", null, { team, path, mac, time: t }));
		},
	});

	makeRoute(app, "teamInfo", {
		validator: z.object({ id: z.int() }),
		async handler(c, { id }) {
			await keyAuth(c, false);
			return await transaction(trx => toAdminTeam(trx, id));
		},
	});
}
