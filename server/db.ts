import Database from "better-sqlite3";
import { GeneratedAlways, Insertable, Kysely, Migration, MigrationProvider, Migrator, Selectable,
	sql, SqliteDialect, Transaction, Updateable } from "kysely";
import { parseExtra, stringifyExtra, UserInfo } from "../shared/util.ts";

type Database = {
	team: {
		id: GeneratedAlways<number>;
		joinCode: string;
		name: string;
		logo: Buffer | null;
		logoMime: string | null;
	};
	emailVerification: { id: GeneratedAlways<number>; key: string; email: string };
	user: { id: GeneratedAlways<number>; team: number | null; email: string; data: string };
	session: { id: GeneratedAlways<number>; created: number; key: string; user: number };
	properties: { key: string; value: string };
};

export type UserData = {
	info: Partial<UserInfo>;
	submitted: UserInfo | null;
	lastEdited: number;
	passwordSalt: string;
	passwordHash: string;
};

type DatabaseData = {
	team: Database["team"];
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
								c.notNull()).addColumn("logo", "blob").addColumn("logoMime", "text").addColumn(
								"joinCode",
								"text",
								c => c.notNull(),
							).execute();
						await db.schema.createTable("emailVerification").addColumn("id", "integer", c =>
							c.primaryKey().autoIncrement()).addColumn("key", "text", c =>
								c.notNull()).addColumn("email", "text", c =>
								c.notNull().unique()).execute();
						await db.schema.createTable("user").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("team", "integer", col =>
								col.references("team.id").onDelete("set null")).addColumn("email", "text", c =>
								c.notNull().unique()).addColumn("data", "json", col =>
								col.notNull()).execute();
						await db.schema.createTable("session").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("created", "integer", c =>
								c.notNull()).addColumn("key", "text", c =>
								c.notNull()).addColumn("user", "integer", c =>
								c.references("user.id")).execute();
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
