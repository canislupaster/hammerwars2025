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
	maxFactLength, maxPromptLength, resumeMaxSize, screenshotMaxWidth, shirtSizes,
	TeamContestProperties, teamFilesMaxSize, teamLimit, UserInfo, validDiscordRe, validFilenameRe,
	validFullNameRe, validNameRe } from "../shared/util.ts";
import { DBTransaction, EventEmitter, getDb, getDbCheck, getProperties, getProperty,
	propertiesChanged, PropertyChangeParam, setDb, setProperty, transaction, updateDb,
	UserData } from "./db.ts";
import { domJudge } from "./domjudge.ts";
import { makeVerificationEmail } from "./email.ts";
import { auth, Context, env, err, genKey, getKey, HonoEnv, keyAuth, makeRoute, matchKey, openai,
	rootUrl, sesClient } from "./main.ts";
import { evalSolutions, presentation } from "./presentation.ts";

const passwordSchema = z.string().min(8).max(100);
const nameSchema = z.string().regex(new RegExp(validNameRe));
const fullNameSchema = z.string().regex(new RegExp(validFullNameRe, "u"));
const inPersonSchema = z.object({
	dinner: z.enum(["cheese", "pepperoni", "sausage", "none"]),
	lunch: z.enum(["ham", "turkey", "tuna", "veggie", "none"]),
	shirtSize: z.enum([...shirtSizes, "none"]),
});
const discordSchema = z.string().regex(new RegExp(validDiscordRe));
const userInfoSchema = z.object({
	name: fullNameSchema,
	discord: discordSchema.nullable(),
	inPerson: inPersonSchema.nullable(),
	shirtSeed: z.int32(),
	shirtHue: z.number().min(0).max(360),
});
const partialUserInfoSchema = z.object({
	name: fullNameSchema.optional(),
	discord: discordSchema.nullable(),
	inPerson: inPersonSchema.partial().nullable(),
	shirtSeed: z.int32(),
	shirtHue: z.number().min(0).max(360),
	agreeRules: z.boolean(),
});

const presentationCountdownSchema = z.object({
	type: z.literal("countdown"),
	to: z.number(),
	title: z.string(),
});

const presentationSubmissionsSchema = z.object({
	type: z.literal("submissions"),
	problems: z.array(
		z.object({
			label: z.string(),
			solutions: z.array(
				z.object({
					title: z.string(),
					summary: z.string(),
					language: z.string(),
					source: z.string(),
					team: z.number(),
				}),
			),
		}),
	),
	teamVerdicts: z.map(z.number(), z.map(z.string(), z.number())),
});

const presentationDuelSchema = z.object({
	type: z.literal("duel"),
	cfContestId: z.number(),
	layout: z.enum(["left", "both", "right", "score"]),
	players: z.array(z.object({ name: z.string(), cf: z.string(), src: z.string().optional() })),
});

const presentationSchema = z.object({
	queue: z.union([
		presentationDuelSchema,
		presentationCountdownSchema,
		presentationSubmissionsSchema,
		z.object({ type: z.literal("image"), src: z.string() }),
		z.object({ type: z.literal("video"), src: z.string(), logo: z.string().optional() }),
		z.object({ type: z.literal("scoreboard") }),
	]).array(),
	current: z.int(),
});

const teamFileSchema = z.object({
	name: z.string().regex(new RegExp(validFilenameRe)),
	base64: z.base64(),
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
				const key = Buffer.from(req.key, "hex");
				return verify != null && verify.key.byteLength == key.byteLength
					&& timingSafeEqual(verify.key, key);
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
		validator: z.object({ id: z.number(), key: z.hex(), password: passwordSchema.nullable() }),
		handler: async (c, req) => {
			return await transaction(async trx => {
				const row = await getDbCheck(trx, "emailVerification", req.id);
				const key = Buffer.from(req.key, "hex");
				if (row == null || key.byteLength != row.key.byteLength || !timingSafeEqual(row.key, key)) {
					throw err("Invalid verification key");
				}

				const prevUser = await trx.selectFrom("user").select("id").where("email", "=", row.email)
					.executeTakeFirst();
				if (req.password == null) {
					if (prevUser == null) throw err("User doesn't exist");
					await makeSession(c, trx, prevUser.id);
					return;
				}

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

	const checkRegistrationOpen = async (trx: DBTransaction, inPerson: boolean) => {
		if (!inPerson && await getProperty(trx, "onlineRegistrationOpen") != true) {
			throw err("Online registration is not open");
		} else if (inPerson) {
			if (await getProperty(trx, "registrationOpen") != true) {
				throw err("In-person registration is not open");
			}
			const ends = await getProperty(trx, "registrationEnds");
			if (ends != null && Date.now() >= ends) {
				throw err("In-person registration has ended");
			}
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
						await checkRegistrationOpen(trx, req.info.inPerson != null);

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
			funFact: z.string().min(1).max(maxFactLength).nullable(),
			logo: z.object({ base64: z.base64(), mime: z.enum(["image/png", "image/jpeg"]) }).or(
				z.literal("remove"),
			).optional(),
			files: z.array(teamFileSchema).or(z.literal("remove")).optional(),
		}),
		handler: async (c, req) => {
			const userId = await auth(c);
			await transaction(async trx => {
				const u = await getDb(trx, "user", userId);
				if (u == null) throw err("user does not exist");

				if (u.team == null) {
					// dont allow in person team creation after close
					await checkRegistrationOpen(trx, u.data.submitted?.inPerson != null);
				}

				let teamId: number;
				const common = { name: req.name, funFact: req.funFact };
				const filesReq = req.files ?? null;
				if (u.team != null) {
					teamId = u.team;
					await setDb(trx, "team", u.team, common);
				} else {
					teamId = await setDb(trx, "team", null, {
						joinCode: fill(10, () => randomInt(0, 9).toString()).join(""),
						...common,
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

				if (filesReq == "remove") {
					await trx.deleteFrom("teamFile").where("team", "=", teamId).execute();
				} else if (filesReq != null) {
					let curSize = (await trx.selectFrom("teamFile").select(({ fn }) =>
						fn.sum<number | null>(fn<number>("length", ["fileData"])).as("totalLength")
					).where("team", "=", teamId).executeTakeFirstOrThrow()).totalLength ?? 0;

					for (const file of filesReq) {
						const data = Buffer.from(file.base64, "base64");
						curSize += data.byteLength;
						if (curSize > teamFilesMaxSize) {
							throw err("maximum team file size exceeded");
						}
						await setDb(trx, "teamFile", null, { team: teamId, name: file.name, fileData: data });
					}
				}

				teamChanged.emit(teamId);
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
				const u = await getDbCheck(trx, "user", userId);
				if (u.team != null) {
					throw err("You need to leave your team first");
				}
				const team = await trx.selectFrom("team").selectAll().where("joinCode", "==", req.joinCode)
					.executeTakeFirst();
				if (!team) throw err("Invalid join code.");
				const mems = await getMembers(trx, team.id);

				await checkRegistrationOpen(
					trx,
					[u, ...mems].some(v => v.data.submitted?.inPerson != null),
				);

				if (mems.length+1 > teamLimit && team.id != await getProperty(trx, "organizerTeamId")) {
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
				const u = await getDbCheck(trx, "user", userId);
				await checkRegistrationOpen(trx, u.data.submitted?.inPerson != null);
				if (u.team == null) throw err("User is not in a team");
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

				const nonTeamData = {
					organizer: team != null && team == await getProperty(trx, "organizerTeamId"),
					info: data.info,
					submitted: data.submitted != null,
					confirmedAttendance: data.confirmedAttendance != undefined && data.submitted != null,
					lastEdited: data.lastEdited,
					pairUp: data.pairUp == true,
					hasResume: resume != undefined,
				};

				if (team != null) {
					const teamData = await getDbCheck(trx, "team", team);
					const logo = await trx.selectFrom("teamLogo").select("teamLogo.id").where(
						"team",
						"=",
						team,
					).executeTakeFirst();
					const files = await trx.selectFrom("teamFile").select((
						{ fn },
					) => ["name", fn<number>("length", ["fileData"]).as("size")]).where("team", "=", team)
						.execute();
					return {
						...nonTeamData,
						team: {
							id: team,
							funFact: teamData.funFact,
							logo: logo != null ? getTeamLogoURL(logo.id) : null,
							joinCode: teamData.joinCode,
							name: teamData.name,
							members: (await getMembers(trx, team)).map(v => ({
								email: v.email,
								name: v.data.info.name ?? null,
								id: v.id,
								inPerson: v.data.submitted ? v.data.submitted.inPerson != null : null,
							})),
							files: files.map(file => ({ name: file.name, size: file.size })),
						},
					};
				}

				return { ...nonTeamData, team: null };
			});
		},
	});

	makeRoute(app, "confirmAttendance", {
		validator: z.object({ pairUp: z.boolean() }),
		async handler(c, req) {
			const userId = await auth(c);
			await transaction(trx => {
				return updateDb(
					trx,
					"user",
					userId,
					async old => ({
						...old,
						data: { ...old.data, confirmedAttendance: Date.now(), pairUp: req.pairUp },
					}),
				);
			});
		},
	});

	makeRoute(app, "registrationWindow", {
		async handler(_c) {
			return await transaction(async trx => ({
				inPersonOpen: await getProperty(trx, "registrationOpen") ?? false,
				inPersonCloses: await getProperty(trx, "registrationEnds"),
				onlineOpen: await getProperty(trx, "onlineRegistrationOpen") ?? false,
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
			organizerTeamId: z.int().nullable(),
			domJudgeCid: z.string(),
			resolveIndex: z.object({ type: z.literal("index"), index: z.int() }).or(
				z.object({
					type: z.literal("problem"),
					forward: z.boolean(),
					team: z.int(),
					prob: z.string(),
				}),
			).nullable(),
			focusTeamId: z.int().nullable(),
			team: z.object({
				firewallEnabled: z.boolean(),
				screenshotsEnabled: z.boolean(),
				visibleDirectories: z.string().array(),
			}),
			presentation: presentationSchema,
			daemonUpdate: z.object({ version: z.int(), source: z.string() }).nullable(),
			onlineRegistrationOpen: z.boolean(),
		}).partial().strip(),
		async handler(c, req) {
			await keyAuth(c, true);
			await transaction(async trx => {
				// zod strips unknown keys
				for (const k in req) {
					await setProperty(trx, ...[k, req[k as keyof ContestProperties]] as PropertyChangeParam);
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
					const emailKey = await trx.selectFrom("emailVerification").select(["id", "key"]).where(
						"email",
						"=",
						udata.email,
					).executeTakeFirst();
					out.users.push({
						id,
						email: udata.email,
						emailKey: emailKey == undefined
							? null
							: { id: emailKey.id, key: emailKey.key.toString("hex") },
						lastEdited: udata.data.lastEdited,
						pairUp: udata.data.pairUp ?? null,
						confirmedAttendanceTime: udata.data.confirmedAttendance ?? null,
						submitted: udata.data.submitted,
						info: udata.data.info,
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

	makeRoute(app, "setUsers", {
		validator: z.array(
			z.object({
				id: z.number(),
				email: z.email(),
				team: z.int().nullable(),
				submitted: userInfoSchema.nullable(),
			}).or(z.object({ id: z.number(), delete: z.literal(true) })),
		),
		async handler(c, req) {
			await keyAuth(c, true);
			await transaction(async trx => {
				for (const user of req) {
					const old = await getDbCheck(trx, "user", user.id);

					if ("delete" in user) {
						await setDb(trx, "user", user.id, null);
					} else {
						await setDb(trx, "user", user.id, {
							email: user.email,
							data: {
								...old.data,
								lastEdited: Date.now(),
								submitted: user.submitted,
								info: user.submitted != null
									? { ...user.submitted, agreeRules: true }
									: old.data.info,
							},
							team: user.team,
						});

						if (user.team != null) teamChanged.emit(user.team);
					}

					if (old.team != null) teamChanged.emit(old.team);
				}
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

	makeRoute(app, "getScoreboard", {
		async handler() {
			return domJudge.scoreboard.v;
		},
	});

	makeRoute(app, "scoreboard", {
		feed: true,
		handler: async function* handler(abort) {
			yield domJudge.scoreboard.v;
			while (!abort.aborted) {
				const sc = await domJudge.scoreboard.change.wait(abort);
				if (sc == null) return;
				yield sc;
			}
		},
	});

	const announcementEvent = new EventEmitter<{ team: number | null; id: number }>();
	makeRoute(app, "announce", {
		validator: z.object({
			teams: z.literal("allTeams").or(z.int().array()),
			title: z.string(),
			body: z.string(),
		}),
		async handler(c, { teams, title, body }) {
			await keyAuth(c, true);
			await transaction(async trx => {
				if (teams == "allTeams") {
					const id = await setDb(trx, "announcement", null, {
						team: null,
						title,
						body,
						time: Date.now(),
					});
					announcementEvent.emit({ team: null, id });
				} else {
					for (const team of new Set(teams)) {
						const id = await setDb(trx, "announcement", null, {
							team,
							title,
							body,
							time: Date.now(),
						});
						announcementEvent.emit({ team, id });
					}
				}
			});
		},
	});

	makeRoute(app, "getAnnouncement", {
		validator: z.object({ team: z.int(), afterId: z.int() }),
		async handler(c, { team, afterId }) {
			await keyAuth(c, false);
			return await transaction(trx => {
				return trx.selectFrom("announcement").select(["id", "body", "title", "time"]).where(a =>
					a("team", "=", team).or("team", "is", null)
				).where("id", ">", afterId).orderBy("id", "asc").limit(1).executeTakeFirst();
			}) ?? null;
		},
	});

	makeRoute(app, "teamFeed", {
		feed: true,
		validator: z.object({ id: z.int() }),
		handler: async function* handler(abort, c, { id }) {
			await keyAuth(c, false);

			const getTeamData = async () => {
				const team = await transaction(trx => getDbCheck(trx, "team", id));
				const domJudgeUser = team.domJudgeId != null
					? domJudge.getTeamUsername(team.domJudgeId)
					: null;
				const cred = domJudgeUser != null && team.domJudgePassword != null
					? { user: domJudgeUser, pass: team.domJudgePassword }
					: null;
				const files = await transaction(trx =>
					trx.selectFrom("teamFile").select("id").where("team", "=", id).execute()
				);
				return { domJudgeCredentials: cred, teamFiles: files.map(v => v.id) };
			};

			const getLastAnnouncement = async () => {
				return (await transaction(trx =>
					trx.selectFrom("announcement").select("id").where(a =>
						a("team", "=", id).or("team", "is", null)
					).orderBy("id", "desc").limit(1).executeTakeFirst()
				))?.id ?? null;
			};

			type Update = { type: "teamChanged" } | { type: "active"; active: DOMJudgeActiveContest } | {
				type: "props";
				props: TeamContestProperties;
			} | { type: "daemon"; version: number | null } | { type: "announcement"; id: number };

			const emitter = new EventEmitter<Update>();

			this.use(teamChanged.on(v => {
				if (v == id) emitter.emit({ type: "teamChanged" });
			}));

			this.use(announcementEvent.on(({ team, id }) => {
				if (team == null || team == id) emitter.emit({ type: "announcement", id });
			}));

			this.use(domJudge.activeContest.change.on(v => emitter.emit({ type: "active", active: v })));

			const defaultTeamProps: TeamContestProperties = {
				firewallEnabled: false,
				screenshotsEnabled: false,
				visibleDirectories: [],
			};

			this.use(propertiesChanged.on(c => {
				if (c.k == "team") {
					emitter.emit({ type: "props", props: c.v ?? defaultTeamProps });
				} else if (c.k == "daemonUpdate") {
					emitter.emit({ type: "daemon", version: c.v?.version ?? null });
				}
			}));

			const queue: (typeof emitter extends EventEmitter<infer T> ? T : never)[] = [];

			// if i just wait there's a race thing which is really dumb
			this.use(emitter.on(update => queue.push(update)));
			let state = {
				...await getTeamData(),
				domJudgeActiveContest: domJudge.activeContest.v,
				teamProperties: (await transaction(trx => getProperty(trx, "team"))) ?? defaultTeamProps,
				daemonVersion: (await transaction(trx => getProperty(trx, "daemonUpdate")))?.version
					?? null,
				lastAnnouncementId: await getLastAnnouncement(),
			};

			while (!abort.aborted) {
				yield { type: "update", state };
				const ev = queue.pop();
				if (ev == undefined) {
					await emitter.wait();
					continue;
				}
				if (ev.type == "teamChanged") state = { ...state, ...await getTeamData() };
				else if (ev.type == "active") state.domJudgeActiveContest = ev.active;
				else if (ev.type == "announcement") state.lastAnnouncementId = ev.id;
				else if (ev.type == "daemon") state.daemonVersion = ev.version;
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
			await transaction(async trx => {
				if ((await getProperty(trx, "team"))?.screenshotsEnabled != true) {
					throw err("screenshots not enabled");
				}
				await setDb(trx, "teamScreenshot", null, { team, path, mac, time: t });
			});
		},
	});

	makeRoute(app, "teamInfo", {
		validator: z.object({ id: z.int() }),
		async handler(c, { id }) {
			await keyAuth(c, false);
			return await transaction(trx => toAdminTeam(trx, id));
		},
	});

	makeRoute(app, "getDaemonSource", {
		async handler(c) {
			await keyAuth(c, false);
			return await transaction(trx => getProperty(trx, "daemonUpdate"));
		},
	});

	makeRoute(app, "presentation", {
		feed: true,
		handler: async function* handler(signal) {
			while (!signal.aborted) {
				yield presentation.state.v;
				await presentation.state.change.wait(signal);
			}
		},
	});

	makeRoute(app, "getPresentationQueue", {
		async handler(c) {
			await keyAuth(c, true);
			return await transaction(trx => getProperty(trx, "presentation"))
				?? { queue: [], current: 0 };
		},
	});

	makeRoute(app, "getPreFreezeSolutions", {
		validator: z.object({ label: z.string(), intendedSolution: z.string() }).array(),
		async handler(c, req) {
			await keyAuth(c, true);
			const [subs, verdicts] = await domJudge.getPreFreezeSolutions();
			const problems = (await Promise.all(
				Map.groupBy(subs, k => k.problem).entries().map(async ([label, subs]) => {
					return { label, solutions: await evalSolutions(subs, req) };
				}),
			)).sort((a, b) =>
				a.label < b.label ? -1 : 1
			);
			return { problems, teamVerdicts: verdicts };
		},
	});

	makeRoute(app, "getSubmission", {
		validator: z.object({ team: z.int(), problem: z.string() }),
		async handler(_, { team, problem }) {
			return await domJudge.getPublicSubmissionSource(team, problem);
		},
	});

	makeRoute(app, "getTeamFile", {
		validator: z.object({ id: z.int() }),
		async handler(c, { id }) {
			await keyAuth(c, false);
			const file = await transaction(trx => getDbCheck(trx, "teamFile", id));
			return { name: file.name, base64: file.fileData.toString("base64") };
		},
	});
}
