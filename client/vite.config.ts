import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const devEnv = loadEnv("development", process.cwd());
const routes = ["/api", "/vdo"];
export default defineConfig(x => ({
	plugins: [preact({ devToolsEnabled: x.mode == "development" }), tailwindcss()],
	server: x.mode != "development"
		? {}
		: {
			headers: {
				"Cross-Origin-Opener-Policy": "same-origin",
				"Cross-Origin-Embedder-Policy": "require-corp",
				"Permissions-Policy": "autoplay=*",
			},
			proxy: Object.fromEntries(
				routes.map(k => [k, { target: devEnv["VITE_API_BASE_URL"], changeOrigin: true }] as const),
			),
		},
}));
