import hljs from "highlight.js";
import "highlight.js/styles/atom-one-dark.css";
import "./code-font.css";
import { useEffect, useRef } from "preact/hooks";
import { twMerge } from "tailwind-merge";

export function CodeBlock(
	{ className, source, language }: { className?: string; source: string; language: string },
) {
	// handle domjudge language names
	const langMap = { "Python 3": "python" } as const;
	const lang = language in langMap
		? langMap[language as keyof typeof langMap]
		: language.toLowerCase();

	useEffect(() => {
		const d = ref.current;
		if (!d) return;
		d.innerHTML = hljs.highlight(source, { language: lang }).value;
	}, [lang, source]);

	const ref = useRef<HTMLDivElement>(null);

	return <div
		className={twMerge(
			"whitespace-pre font-mono bg-zinc-900 text-[15px] leading-[25px] p-2",
			className,
		)}
		ref={ref} />;
}
