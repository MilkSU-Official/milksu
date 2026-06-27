import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";

export const browserGetPage = defineTool({
	name: "browser_get_page",
	label: "Browser Get Page",
	description: "Get current page URL, title, and content (text or HTML)",
	parameters: Type.Object({
		format: Type.Optional(
			Type.Union([Type.Literal("text"), Type.Literal("html"), Type.Literal("summary")], {
				description: "Content format: text (default), html (raw DOM), or summary (title+url+meta only)",
				default: "text",
			}),
		),
		selector: Type.Optional(Type.String({ description: "CSS selector to extract content from a specific element" })),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();
		const format = params.format ?? "text";
		const url = page.url();
		const title = await page.title();

		let content: string;

		if (format === "summary") {
			const meta = await page.evaluate(() => {
				const getMeta = (name: string) =>
					document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ?? "";
				return { description: getMeta("description"), keywords: getMeta("keywords") };
			});
			content = `Title: ${title}\nURL: ${url}\nDescription: ${meta.description}\nKeywords: ${meta.keywords}`;
		} else if (params.selector) {
			const el = page.locator(params.selector).first();
			content =
				format === "html" ? (await el.innerHTML().catch(() => "(element not found)")) : (await el.innerText().catch(() => "(element not found)"));
		} else {
			content =
				format === "html"
					? await page.content()
					: await page.innerText("body").catch(() => "(empty page)");
		}

		if (content.length > 50000) {
			content = content.slice(0, 50000) + "\n\n... (truncated, use selector to narrow down)";
		}

		return {
			content: [{ type: "text", text: `[${title}] ${url}\n\n${content}` }],
			details: { title, url, format, length: content.length },
		};
	},
});

export const browserScreenshot = defineTool({
	name: "browser_screenshot",
	label: "Browser Screenshot",
	description: "Take a screenshot of the current page",
	parameters: Type.Object({
		fullPage: Type.Optional(Type.Boolean({ description: "Capture full scrollable page", default: false })),
		selector: Type.Optional(Type.String({ description: "CSS selector to screenshot a specific element" })),
		path: Type.Optional(Type.String({ description: "File path to save screenshot (if omitted, returns base64)" })),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();

		const target = params.selector ? page.locator(params.selector).first() : page;

		const buffer = await target.screenshot({
			fullPage: params.fullPage ?? false,
			type: "png",
			...(params.path ? { path: params.path } : {}),
		});

		const base64 = buffer.toString("base64");

		if (params.path) {
			return {
				content: [{ type: "text", text: `Screenshot saved to ${params.path} (${buffer.length} bytes)` }],
				details: { path: params.path, size: buffer.length },
			};
		}

		return {
			content: [
				{ type: "text", text: `Screenshot captured (${buffer.length} bytes)` },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
			],
			details: { size: buffer.length },
		};
	},
});

export const browserNavigate = defineTool({
	name: "browser_navigate",
	label: "Browser Navigate",
	description: "Navigate to a URL in the current tab",
	parameters: Type.Object({
		url: Type.String({ description: "URL to navigate to" }),
		waitUntil: Type.Optional(
			Type.Union([Type.Literal("load"), Type.Literal("domcontentloaded"), Type.Literal("networkidle")], {
				description: "Wait condition",
				default: "load",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();

		const response = await page.goto(params.url, {
			waitUntil: params.waitUntil ?? "load",
			timeout: 30000,
		});

		const title = await page.title();
		const status = response?.status() ?? 0;

		return {
			content: [{ type: "text", text: `Navigated to: "${title}" (${page.url()})\nHTTP status: ${status}` }],
			details: { title, url: page.url(), status },
		};
	},
});
