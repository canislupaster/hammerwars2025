import Database from "better-sqlite3";
import { GeneratedAlways, Insertable, Kysely, Migration, MigrationProvider, Migrator, Selectable,
	sql, SqliteDialect, Transaction, Updateable } from "kysely";
import { ContestProperties, parseExtra, PartialUserInfo, stringifyExtra,
	UserInfo } from "../shared/util.ts";

type Database = {
	team: {
		id: GeneratedAlways<number>;
		joinCode: string;
		name: string;
		domJudgeId: string | null;
		domJudgeUser: string | null;
		domJudgePassword: string | null;
	};
	teamLogo: { id: GeneratedAlways<number>; team: number; logo: Buffer; logoMime: string };
	teamScreenshot: {
		id: GeneratedAlways<number>;
		team: number;
		mac: string;
		time: number;
		path: string;
	};
	emailVerification: { id: GeneratedAlways<number>; key: string; email: string };
	user: { id: GeneratedAlways<number>; team: number | null; email: string; data: string };
	resume: { id: GeneratedAlways<number>; user: number; file: Buffer };
	session: { id: GeneratedAlways<number>; created: number; key: string; user: number };
	properties: { key: string; value: string };
};

export type UserData = {
	info: PartialUserInfo;
	submitted: UserInfo | null;
	lastEdited: number;
	passwordSalt: string;
	passwordHash: string;
};

type DatabaseData = {
	team: Database["team"];
	teamLogo: Database["teamLogo"];
	teamScreenshot: Database["teamScreenshot"];
	resume: Database["resume"];
	user: Omit<Database["user"], "data"> & { data: UserData };
	session: Database["session"];
	emailVerification: Database["emailVerification"];
};

const db = new Kysely<Database>({
	dialect: new SqliteDialect({
		database: new Database("./db.sqlite"),
		async onCreateConnection(connection) {
			await connection.executeQuery(sql`PRAGMA foreign_key_check`.compile(db));
		},
	}),
});

const migrator = new Migrator({
	db,
	provider: {
		async getMigrations() {
			return {
				"1_init": {
					async up(db) {
						await db.schema.createTable("team").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("name", "text", c =>
								c.notNull()).addColumn("joinCode", "text", c =>
								c.notNull()).addColumn("domJudgeId", "text", c =>
								c.unique()).addColumn("domJudgePassword", "text").execute();
						await db.schema.createTable("emailVerification").addColumn("id", "integer", c =>
							c.primaryKey().autoIncrement()).addColumn("key", "text", c =>
								c.notNull()).addColumn("email", "text", c =>
								c.notNull().unique()).execute();
						await db.schema.createTable("user").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("team", "integer", col =>
								col.references("team.id").onDelete("set null")).addColumn("email", "text", c =>
								c.notNull().unique()).addColumn("data", "json", col =>
								col.notNull()).execute();
						await db.schema.createTable("teamLogo").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("team", "integer", col =>
								col.notNull().references("team.id").onDelete("cascade").unique()).addColumn(
								"logo",
								"blob",
								c => c.notNull(),
							).addColumn("logoMime", "text", c =>
								c.notNull()).execute();
						await db.schema.createTable("teamScreenshot").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("team", "integer", c =>
								c.notNull().references("team.id")).addColumn("mac", "text", c =>
								c.notNull()).addColumn("time", "integer", c =>
								c.notNull()).addColumn("path", "text", c =>
								c.notNull()).execute();
						await db.schema.createTable("resume").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("user", "integer", col =>
								col.notNull().references("user.id").unique()).addColumn("file", "blob", col =>
								col.notNull()).execute();
						await db.schema.createTable("session").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("created", "integer", c =>
								c.notNull()).addColumn("key", "text", c =>
								c.notNull()).addColumn("user", "integer", c =>
								c.references("user.id").onDelete("cascade")).execute();
						await db.schema.createTable("properties").addColumn("key", "text", c =>
							c.primaryKey().notNull()).addColumn("value", "json", c =>
								c.notNull()).execute();
					},
					async down(db) {
						await db.schema.dropIndex("emailVerification").execute();
						await db.schema.dropIndex("user").execute();
						await db.schema.dropTable("team").execute();
						await db.schema.dropTable("properties").execute();
						await db.schema.dropTable("session").execute();
					},
				} satisfies Migration,
			};
		},
	} satisfies MigrationProvider,
});

console.log("migrating database...");

const res = await migrator.migrateToLatest();
if (res.error != undefined) {
	console.error("migration failed", res.error);
}

console.log("database ready");

export type CrudRequest = {
	[Which in keyof DatabaseData]:
		& (DatabaseData[Which] extends { data: unknown } ? { data: DatabaseData[Which]["data"] }
			: unknown)
		& {
			which: Which;
			update: (old: Selectable<DatabaseData[Which]>) => Promise<Updateable<DatabaseData[Which]>>;
			get: Selectable<DatabaseData[Which]> | null;
			set: Updateable<DatabaseData[Which]> | null;
			add: Insertable<DatabaseData[Which]>;
		};
};

export type DBTransaction = Transaction<Database>;

export async function transaction<T>(f: (trx: DBTransaction) => Promise<T>): Promise<T> {
	return await db.transaction().execute(f);
}

export async function getDb<T extends keyof DatabaseData>(
	trx: DBTransaction,
	table: T,
	id: number,
): Promise<CrudRequest[T]["get"]> {
	const res = await trx.selectFrom(table satisfies keyof DatabaseData).selectAll().where(
		"id",
		"=",
		id,
	).executeTakeFirst();
	if (res == undefined) return null;
	return ("data" in res ? { ...res, data: parseExtra(res.data) } : res) as unknown as CrudRequest[
		T
	]["get"];
}

export async function getDbCheck<T extends keyof DatabaseData>(
	trx: DBTransaction,
	table: T,
	id: number,
): Promise<NonNullable<CrudRequest[T]["get"]>> {
	const ret = await getDb(trx, table, id);
	if (ret == null) throw new Error(`${table} ${id} doesn't exist`);
	return ret;
}

export async function setDb<T extends keyof DatabaseData, Create extends boolean>(
	trx: DBTransaction,
	table: T,
	id: Create extends true ? null : number,
	newValue: Create extends true ? CrudRequest[T]["add"] : CrudRequest[T]["set"],
): Promise<number> {
	if (newValue == null) {
		const deleted =
			(await trx.deleteFrom(table satisfies keyof DatabaseData).where("id", "=", id)
				.executeTakeFirstOrThrow()).numDeletedRows;
		if (deleted == 0n) throw new Error(`Failed to delete ${id} from ${table}`);
		return id as number;
	}

	const newValue2 = "data" in newValue
		? { ...newValue, data: stringifyExtra(newValue.data) }
		: newValue;
	if (id == null) {
		return (await trx.insertInto(table).returning("id").values(
			newValue2 as Insertable<Database[CrudRequest[T]["which"]]>,
		).executeTakeFirstOrThrow()).id;
	} else {
		await trx.updateTable(table satisfies keyof DatabaseData).where("id", "=", id).set(
			newValue2 as Updateable<Database[CrudRequest[T]["which"]]>,
		).execute();
		return id;
	}
}

export async function updateDb<T extends keyof DatabaseData>(
	trx: DBTransaction,
	table: T,
	id: number,
	update: CrudRequest[T]["update"],
): Promise<void> {
	const old = await getDb(trx, table, id);
	if (!old) throw new Error(`${table} ${id} not found`);
	await setDb(trx, table, id, await update(old));
}

export async function getProperty<T extends keyof ContestProperties>(
	trx: DBTransaction,
	prop: T,
): Promise<ContestProperties[T] | null> {
	const row = await trx.selectFrom("properties").where("key", "=", prop).select("value")
		.executeTakeFirst();
	if (!row) return null;
	return parseExtra(row.value) as ContestProperties[T];
}

export class EventEmitter<T> {
	#listeners = new Set<(x: T) => void>();
	wait<Abort extends boolean>(...stop: Abort extends true ? [AbortSignal] : []) {
		const abortSignal = stop[0];
		return new Promise<Abort extends true ? T | null : T>(res => {
			const rem = () => {
				this.#listeners.delete(done);
				abortSignal?.removeEventListener("abort", rem);
				res(null as Abort extends true ? T | null : T);
			};
			const done = (v: T) => {
				this.#listeners.delete(done);
				abortSignal?.removeEventListener("abort", rem);
				res(v as Abort extends true ? T | null : T);
			};
			this.#listeners.add(done);
			abortSignal?.addEventListener("abort", rem);
		});
	}
	async waitFor<Abort extends boolean>(
		cond: (x: T) => boolean,
		...stop: Abort extends true ? [AbortSignal] : []
	) {
		while (true) {
			const r = await this.wait(...stop);
			if (r == null) return null;
			if (cond(r)) return r;
		}
	}
	on(f: (x: T) => void): Disposable {
		this.#listeners.add(f);
		return { [Symbol.dispose]: () => this.#listeners.delete(f) };
	}
	emit(x: T) {
		this.#listeners.forEach(y => y(x));
	}
}

export class Mutable<T> {
	#current: T;
	change = new EventEmitter<T>();
	get v() {
		return this.#current;
	}
	set v(newValue: T) {
		this.#current = newValue;
		this.change.emit(newValue);
	}
	constructor(init: T) {
		this.#current = init;
	}
}

export const propertiesChanged = new EventEmitter<Partial<ContestProperties>>();

export async function getProperties(trx: DBTransaction): Promise<Partial<ContestProperties>> {
	const out: Partial<ContestProperties> = {};
	const rows = await trx.selectFrom("properties").selectAll().execute();
	for (const row of rows) {
		out[row.key as keyof ContestProperties] = parseExtra(row.value) as never;
	}
	return out;
}

export async function setProperty<T extends keyof ContestProperties>(
	trx: DBTransaction,
	prop: T,
	value: ContestProperties[T],
) {
	const valueStr = stringifyExtra(value);
	await trx.insertInto("properties").values({ key: prop, value: valueStr }).onConflict(c =>
		c.doUpdateSet({ value: valueStr })
	).execute();
	propertiesChanged.emit(await getProperties(trx));
}
