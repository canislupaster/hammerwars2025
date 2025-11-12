import z from "zod";
export const env = z.parse(
	z.object({
		PROXY_FETCH_URL: z.string().optional(),
		NOSEND_EMAIL: z.literal("1").optional(),
		AWS_REGION: z.string(),
		AWS_ACCESS_KEY_ID: z.string(),
		AWS_SECRET_ACCESS_KEY: z.string(),
		ROOT_URL: z.url(),
		TRUSTED_PROXY: z.string().optional(),
		ADMIN_API_KEY: z.string(),
		CLIENT_API_KEY: z.string(),
		OPENAI_API_KEY: z.string(),
		DOMJUDGE_URL: z.url(),
		DOMJUDGE_API_USER: z.string(),
		DOMJUDGE_API_KEY: z.string(),
		SCREENSHOT_PATH: z.string().optional(),
		CF_API_KEY: z.string().optional(),
		CF_API_SECRET: z.string().optional(),
	}),
	process.env,
);
