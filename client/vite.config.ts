import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const devEnv = loadEnv("development", process.cwd());
export default defineConfig(x => ({
	plugins: [preact({ devToolsEnabled: true }), tailwindcss()],
	server: x.mode != "development"
		? {}
		: {
			proxy: {
				"/api": {
					target: devEnv["VITE_API_BASE_URL"],
					changeOrigin: true,
					rewrite: path => path.replace(/^\/api/, ""),
				},
			},
		},
}));
