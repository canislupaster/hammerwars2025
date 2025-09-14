import Database from "better-sqlite3";
import { GeneratedAlways, Insertable, InsertType, JSONColumnType, Kysely, Migration,
	MigrationProvider, Migrator, ParseJSONResultsPlugin, Selectable, SelectType, SqliteDialect,
	Transaction, Updateable, UpdateType } from "kysely";
import { parseExtra, stringifyExtra, TeamData, UserData } from "../shared/util.ts";

type Database = {
	team: { id: GeneratedAlways<number>; joinCode: string; data: string; logo: Buffer };
	user: { id: GeneratedAlways<number>; team: number | null; data: string };
	properties: { key: string; value: string };
};

type DatabaseData = {
	team: Omit<Database["team"], "data"> & { data: TeamData };
	user: Omit<Database["user"], "data"> & { data: UserData };
};

const db = new Kysely<Database>({
	dialect: new SqliteDialect({ database: new Database("./db.sqlite") }),
	plugins: [],
});

const migrator = new Migrator({
	db,
	provider: {
		async getMigrations() {
			return {
				"1_init": {
					async up(db) {
						await db.schema.createTable("team").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("joinCode", "text", c =>
								c.notNull()).addColumn("data", "json", c =>
								c.notNull()).execute();
						await db.schema.createTable("user").addColumn("id", "integer", col =>
							col.primaryKey().autoIncrement()).addColumn("team", "integer", col =>
								col.references("team.id").onDelete("set null")).addColumn("data", "json", col =>
								col.notNull()).execute();
						await db.schema.createTable("properties").addColumn("key", "text", c =>
							c.primaryKey().notNull()).addColumn("value", "json", c =>
								c.notNull()).execute();
					},
					async down(db) {
						await db.schema.dropIndex("user").execute();
						await db.schema.dropTable("team").execute();
						await db.schema.dropTable("properties").execute();
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

type CrudRequest = {
	[Create in "create" | "update"]: {
		[Which in keyof DatabaseData]: {
			data: DatabaseData[Which]["data"];
			request: {
				which: Which;
				id: Create extends "create" ? null : number;
				f: (
					...old: Create extends "create" ? [] : [Selectable<DatabaseData[Which]>]
				) => Promise<
					Create extends "create" ? Insertable<DatabaseData[Which]>
						: Updateable<DatabaseData[Which]>
				>;
			};
			response: Create extends "create" ? Insertable<DatabaseData[Which]>
				: Updateable<DatabaseData[Which]> | null;
		};
	};
};

export async function crud<T extends CrudRequest["create" | "update"][keyof DatabaseData]>(
	request: T["request"],
): Promise<T["response"]> {
	return await db.transaction().execute(async trx => {
		if (request.id != null) {
			const res = await trx.selectFrom(request.which).selectAll().where("id", "==", request.id)
				.executeTakeFirst();
			// messy casts here but i honestly don't care since it is nice to use
			if (res == undefined) return null;
			const res2 = { ...res, data: parseExtra(res.data) as T["data"] };
			return await (request.f as (t: typeof res2) => Promise<T["response"]>)(res2);
		} else {
			const v = await request.f();
			const v2 = { ...v, data: stringifyExtra(v.data) };
			await trx.insertInto(request.which).values(v2).execute();
			return v2 as unknown as T["response"];
		}
	});
}
