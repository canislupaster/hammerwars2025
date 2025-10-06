export interface ContestState {
	started?: string | null; // TIME
	frozen?: string | null; // TIME
	ended?: string | null; // TIME
	thawed?: string | null; // TIME
	finalized?: string | null; // TIME
	end_of_updates?: string | null; // TIME
}

export interface Scoreboard {
	time?: string; // TIME
	contest_time?: string; // RELTIME
	state: ContestState;
	rows: ScoreboardRow[];
}

export interface ScoreboardRow {
	rank: number;
	team_id: string;
	score: {
		// pass-fail contests
		num_solved: number;
		total_time: string; // RELTIME
		time?: string | null; // RELTIME; MUST be null iff num_solved = 0
	} | {
		// points/score contests
		score: number;
		time?: string | null; // RELTIME
	};
	problems?: ProblemScore[];
}

export interface ProblemScore {
	problem_id: string;
	num_judged: number;
	num_pending: number;
	// pass-fail:
	solved?: boolean;
	// points:
	score?: number;
	// required iff solved === true OR score > 0:
	time?: string; // RELTIME
}

export interface FileRef {
	href?: string;
	filename?: string;
	hash?: string | null;
	mime: string;
	width?: number;
	height?: number;
}

export interface Location {
	latitude: number;
	longitude: number;
}

export interface Contest {
	id: string;
	name: string;
	formal_name?: string | null;
	start_time?: string | null; // TIME
	countdown_pause_time?: string | null; // RELTIME
	duration: string; // RELTIME
	scoreboard_freeze_duration?: string | null; // RELTIME
	scoreboard_thaw_time?: string | null; // TIME
	scoreboard_type: "pass-fail" | "score";
	penalty_time: number; // RELTIME (pass-fail) or it should be, domjudge returns # minutes
	banner?: FileRef[]; // image/*
	logo?: FileRef[]; // image/*
	location?: Location | null;
}

export interface JudgementType {
	id: string; // e.g., "AC", "WA"
	name: string;
	penalty?: boolean; // required iff contest.penalty_time present
	solved: boolean;
}

export interface Command {
	command: string;
	args?: string;
	version?: string;
	version_command?: string;
}

export interface Language {
	id: string;
	name: string;
	entry_point_required: boolean;
	entry_point_name?: string | null;
	extensions: string[];
	compiler?: Command;
	runner?: Command;
}

export interface Problem {
	id: string;
	uuid?: string | null;
	label: string;
	name: string;
	ordinal: number;
	rgb?: string | null;
	color?: string | null;
	time_limit: number;
	memory_limit: number;
	output_limit?: number;
	code_limit?: number;
	test_data_count: number;
	max_score?: number; // when scoreboard_type = 'score'
	package?: FileRef[]; // application/zip
	statement?: FileRef[]; // application/pdf
}

export interface Group {
	id: string;
	icpc_id?: string | null;
	name: string;
	type?: string | null; // e.g., "site", "division"
	location?: Location | null;
}

export interface Organization {
	id: string;
	icpc_id?: string | null;
	name: string;
	formal_name?: string | null;
	country?: string | null; // ISO 3166-1 alpha-3
	country_flag?: FileRef[];
	country_subdivision?: string | null; // ISO 3166-2
	country_subdivision_flag?: FileRef[];
	url?: string | null;
	twitter_hashtag?: string | null;
	twitter_account?: string | null;
	location?: Location | null;
	logo?: FileRef[];
}

export interface Team {
	id: string;
	icpc_id?: string | null;
	name: string;
	label?: string | null;
	display_name?: string | null;
	organization_id?: string | null;
	group_ids?: string[];
	hidden?: boolean;
	location?: { x: number; y: number; rotation: number } | null;
	photo?: FileRef[];
	video?: FileRef[];
	backup?: FileRef[];
	key_log?: FileRef[];
	tool_data?: FileRef[];
	desktop?: FileRef[];
	webcam?: FileRef[];
	audio?: FileRef[];
}

export interface Person {
	id: string;
	icpc_id?: string | null;
	team_ids?: string[]; // required non-empty iff role is 'contestant' or 'coach'
	name: string;
	title?: string | null;
	email?: string | null;
	sex?: "male" | "female" | null;
	role: "contestant" | "coach" | "staff" | "other";
	photo?: FileRef[];
}

export interface Account {
	id: string;
	username: string;
	password?: string | null;
	name?: string | null;
	type: string;
	ip?: string | null;
	team_id?: string | null;
	person_id?: string | null;
}

export interface Submission {
	id: string;
	language_id: string;
	problem_id: string;
	team_id: string;
	time: string; // TIME
	contest_time: string; // RELTIME
	entry_point?: string | null;
	files: FileRef[]; // one zip
	reaction?: FileRef[]; // video/*
}

export interface Judgement {
	id: string;
	submission_id: string;
	judgement_type_id?: string | null; // required iff judgement completed
	score?: number; // required iff scoreboard_type = 'score'
	current?: boolean; // defaults true
	start_time: string; // TIME
	start_contest_time: string; // RELTIME
	end_time?: string | null; // TIME
	end_contest_time?: string | null; // RELTIME
	max_run_time?: number | null; // seconds
}

export interface Run {
	id: string;
	judgement_id: string;
	ordinal: number; // 1..problem.test_data_count
	judgement_type_id: string;
	time: string; // TIME
	contest_time: string; // RELTIME
	run_time: number; // seconds
}

export interface Clarification {
	id: string;
	from_team_id?: string | null;
	to_team_ids?: (string | null)[] | null;
	to_group_ids?: (string | null)[] | null;
	reply_to_id?: string | null;
	problem_id?: string | null;
	text: string;
	time: string; // TIME
	contest_time: string; // RELTIME
}

export interface Award {
	id: string;
	citation: string;
	team_ids?: string[] | null;
}

export interface Commentary {
	id: string;
	time: string; // TIME
	contest_time: string; // RELTIME
	message: string;
	team_ids?: string[];
	problem_ids?: string[];
	submission_ids?: string[];
}

export type BaseNotification<S extends string, T, Single extends boolean = false> = {
	type: S;
	token?: string;
	time: string;
}
	& (Single extends true ? { id: null; data: T }
		: ({ id: null; data: T[] } | { id: string; data: T | null }));

export type Notification = BaseNotification<"contest", Contest, true> | BaseNotification<
	"judgement-types",
	JudgementType
> | BaseNotification<"languages", Language> | BaseNotification<"problems", Problem>
	| BaseNotification<"groups", Group> | BaseNotification<"organizations", Organization>
	| BaseNotification<"teams", Team> | BaseNotification<"persons", Person> | BaseNotification<
	"accounts",
	Account
> | BaseNotification<"state", ContestState, true> | BaseNotification<"submissions", Submission>
	| BaseNotification<"judgements", Judgement> | BaseNotification<"runs", Run> | BaseNotification<
	"clarifications",
	Clarification
> | BaseNotification<"awards", Award> | BaseNotification<"commentary", Commentary>;
