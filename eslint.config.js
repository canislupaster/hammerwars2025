import pluginJs from "@eslint/js";
import preact from "eslint-config-preact";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const commonRules = {
	"@typescript-eslint/ban-ts-comment": "off",
	"@typescript-eslint/require-await": "off",
	"@typescript-eslint/strict-boolean-expressions": "warn",
	"no-useless-constructor": "off",
	"@typescript-eslint/require-array-sort-compare": "warn",
	"@typescript-eslint/no-unused-vars": ["warn", {
		argsIgnorePattern: "^_[^_].*$|^_$",
		varsIgnorePattern: "^_[^_].*$|^_$",
		caughtErrorsIgnorePattern: "^_[^_].*$|^_$",
	}],
};

const common = { rules: commonRules };

export default defineConfig([
	{
		files: ["client/src/*.{ts,tsx,js,jsx,d.ts}", "shared/**/*.ts"],
		extends: [
			pluginJs.configs.recommended,
			...preact,
			...tseslint.configs.recommendedTypeChecked,
			common,
		],
		languageOptions: { globals: { ...globals.browser }, parserOptions: { projectService: true } },
	},
	{ ignores: ["dist"] },
	{
		files: ["scripts/**/*", "server/**/*", "shared/**/*"],
		extends: [pluginJs.configs.recommended, ...tseslint.configs.recommendedTypeChecked, common],
		languageOptions: { globals: { ...globals.node }, parserOptions: { projectService: true } },
	},
]);
