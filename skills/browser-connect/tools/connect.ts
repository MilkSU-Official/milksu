import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let currentPage: Page | null = null;

export function getBrowser(): Browser | null {
	return browser;
}

export function getCurrentPage(): Page | null {
	return currentPage;
}

export function setCurrentPage(page: Page) {
	currentPage = page;
}

export async function ensureConnected(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
	if (!browser || !browser.isConnected()) {
		throw new Error("Not connected to Chrome. Call browser_connect first.");
	}
	if (!context) {
		const contexts = browser.contexts();
		context = contexts[0] ?? (await browser.newContext());
	}
	if (!currentPage || currentPage.isClosed()) {
		const pages = context.pages();
		currentPage = pages[0] ?? (await context.newPage());
	}
	return { browser, context, page: currentPage };
}

export const browserConnect = defineTool({
	name: "browser_connect",
	label: "Browser Connect",
	description: "Connect to user's running Chrome browser via CDP",
	parameters: Type.Object({
		port: Type.Optional(Type.Number({ description: "Chrome remote debugging port", default: 9222 })),
		host: Type.Optional(Type.String({ description: "Chrome remote debugging host", default: "127.0.0.1" })),
	}),
	async execute(_toolCallId, params) {
		const port = params.port ?? 9222;
		const host = params.host ?? "127.0.0.1";
		const endpoint = `http://${host}:${port}`;

		try {
			if (browser?.isConnected()) {
				await browser.close().catch(() => {});
			}

			browser = await chromium.connectOverCDP(endpoint);
			const contexts = browser.contexts();
			context = contexts[0] ?? (await browser.newContext());
			const pages = context.pages();
			currentPage = pages[0] ?? (await context.newPage());

			const tabCount = pages.length;
			const pageTitle = await currentPage.title();
			const pageUrl = currentPage.url();

			return {
				content: [
					{
						type: "text",
						text: `Connected to Chrome at ${endpoint}\nTabs: ${tabCount}\nActive tab: "${pageTitle}" (${pageUrl})`,
					},
				],
				details: { endpoint, tabCount, pageTitle, pageUrl },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [
					{
						type: "text",
						text: `Failed to connect to Chrome at ${endpoint}: ${msg}\n\nMake sure Chrome is running with: --remote-debugging-port=${port}`,
					},
				],
				details: { error: msg },
			};
		}
	},
});

export const browserListTabs = defineTool({
	name: "browser_list_tabs",
	label: "Browser List Tabs",
	description: "List all open tabs in the connected Chrome browser",
	parameters: Type.Object({}),
	async execute() {
		const { context: ctx } = await ensureConnected();
		const pages = ctx.pages();

		const tabs = await Promise.all(
			pages.map(async (page, i) => {
				const title = await page.title().catch(() => "(untitled)");
				return `[${i}] ${title}\n    ${page.url()}${page === currentPage ? "  ← active" : ""}`;
			}),
		);

		return {
			content: [{ type: "text", text: tabs.length > 0 ? tabs.join("\n") : "No tabs open" }],
			details: { count: tabs.length },
		};
	},
});

export const browserSwitchTab = defineTool({
	name: "browser_switch_tab",
	label: "Browser Switch Tab",
	description: "Switch to a specific tab by index or URL pattern",
	parameters: Type.Object({
		index: Type.Optional(Type.Number({ description: "Tab index (from browser_list_tabs)" })),
		urlPattern: Type.Optional(Type.String({ description: "URL substring to match" })),
	}),
	async execute(_toolCallId, params) {
		const { context: ctx } = await ensureConnected();
		const pages = ctx.pages();

		let target: Page | undefined;

		if (params.index !== undefined) {
			target = pages[params.index];
			if (!target) {
				return {
					content: [{ type: "text", text: `No tab at index ${params.index}. Use browser_list_tabs to see available tabs.` }],
					details: { error: "index out of range" },
				};
			}
		} else if (params.urlPattern) {
			target = pages.find((p) => p.url().includes(params.urlPattern!));
			if (!target) {
				return {
					content: [{ type: "text", text: `No tab matching URL pattern "${params.urlPattern}"` }],
					details: { error: "no match" },
				};
			}
		} else {
			return {
				content: [{ type: "text", text: "Provide either index or urlPattern" }],
				details: { error: "missing param" },
			};
		}

		currentPage = target;
		await target.bringToFront();
		const title = await target.title();

		return {
			content: [{ type: "text", text: `Switched to: "${title}" (${target.url()})` }],
			details: { title, url: target.url() },
		};
	},
});
