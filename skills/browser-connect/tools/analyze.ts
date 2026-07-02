import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";

export const browserAnalyze = defineTool({
	name: "browser_analyze",
	label: "Browser Analyze",
	description:
		"Analyze the current page for security-relevant elements: forms (with hidden fields, CSRF tokens), links (internal/external), scripts (inline/external), cookies, meta tags, and response headers. Use this as a first step when assessing a web application page.",
	parameters: Type.Object({
		scope: Type.Optional(
			Type.Array(
				Type.Union([
					Type.Literal("forms"),
					Type.Literal("links"),
					Type.Literal("scripts"),
					Type.Literal("cookies"),
					Type.Literal("headers"),
					Type.Literal("storage"),
				]),
				{ description: "Which analyses to run (default: all)" },
			),
		),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();
		const scope = params.scope ?? ["forms", "links", "scripts", "cookies", "headers", "storage"];
		const result: Record<string, unknown> = {};

		if (scope.includes("forms")) {
			result.forms = await page.evaluate(() => {
				return Array.from(document.querySelectorAll("form")).map((form) => ({
					action: form.action,
					method: form.method,
					id: form.id || null,
					inputs: Array.from(form.querySelectorAll("input, select, textarea")).map((el) => ({
						name: (el as HTMLInputElement).name,
						type: (el as HTMLInputElement).type,
						value: (el as HTMLInputElement).type === "hidden" ? (el as HTMLInputElement).value : null,
					})),
				}));
			});
		}

		if (scope.includes("links")) {
			result.links = await page.evaluate(() => {
				const origin = window.location.origin;
				return Array.from(document.querySelectorAll("a[href]")).map((a) => {
					const href = (a as HTMLAnchorElement).href;
					return {
						href,
						text: (a as HTMLAnchorElement).innerText.trim().slice(0, 80),
						external: !href.startsWith(origin),
					};
				});
			});
		}

		if (scope.includes("scripts")) {
			result.scripts = await page.evaluate(() => {
				return Array.from(document.querySelectorAll("script")).map((s) => ({
					src: s.src || null,
					inline: !s.src,
					length: s.src ? null : s.textContent?.length ?? 0,
					type: s.type || null,
					nonce: s.nonce || null,
				}));
			});
		}

		if (scope.includes("cookies")) {
			const cookies = await page.context().cookies();
			result.cookies = cookies.map((c) => ({
				name: c.name,
				domain: c.domain,
				path: c.path,
				httpOnly: c.httpOnly,
				secure: c.secure,
				sameSite: c.sameSite,
				expires: c.expires,
			}));
		}

		if (scope.includes("headers")) {
			result.headers = await page.evaluate(() => {
				const meta: Record<string, string> = {};
				document.querySelectorAll("meta").forEach((m) => {
					const name = m.getAttribute("name") || m.getAttribute("http-equiv");
					const content = m.getAttribute("content");
					if (name && content) meta[name] = content;
				});
				return meta;
			});
		}

		if (scope.includes("storage")) {
			result.storage = await page.evaluate(() => {
				const ls: Record<string, string> = {};
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key) ls[key] = localStorage.getItem(key)?.slice(0, 200) ?? "";
				}
				const ss: Record<string, string> = {};
				for (let i = 0; i < sessionStorage.length; i++) {
					const key = sessionStorage.key(i);
					if (key) ss[key] = sessionStorage.getItem(key)?.slice(0, 200) ?? "";
				}
				return { localStorage: ls, sessionStorage: ss };
			});
		}

		const url = page.url();
		const title = await page.title();
		const text = JSON.stringify(result, null, 2);

		return {
			content: [{ type: "text", text: `Page analysis for [${title}] (${url}):\n\n${text}` }],
			details: { url, title, ...result },
		};
	},
});
