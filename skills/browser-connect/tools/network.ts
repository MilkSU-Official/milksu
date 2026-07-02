import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";

interface CapturedExchange {
	url: string;
	method: string;
	requestHeaders: Record<string, string>;
	postData: string | null;
	status: number | null;
	responseHeaders: Record<string, string>;
	contentType: string | null;
	responseSize: number | null;
	timing: number | null;
	timestamp: number;
}

const exchanges: CapturedExchange[] = [];
let monitorActive = false;
let cleanupFns: (() => void)[] = [];

export const browserNetwork = defineTool({
	name: "browser_network",
	label: "Browser Network",
	description:
		"Start or stop passive network monitoring. Captures HTTP request/response pairs with headers, status, size, and timing. Use 'start' to begin, 'stop' to end and get the full log, 'log' to read current captures. Optionally filter by URL pattern and/or HTTP method.",
	parameters: Type.Object({
		action: Type.Union(
			[Type.Literal("start"), Type.Literal("stop"), Type.Literal("log")],
			{ description: "start/stop/log" },
		),
		urlFilter: Type.Optional(
			Type.String({ description: "Only capture URLs containing this substring" }),
		),
		methodFilter: Type.Optional(
			Type.String({ description: "Only capture this HTTP method (GET, POST, etc.)" }),
		),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();

		if (params.action === "log") {
			const filtered = filterExchanges(exchanges, params.urlFilter, params.methodFilter);
			return {
				content: [
					{
						type: "text",
						text: monitorActive
							? `Monitoring. ${filtered.length} exchange(s):\n${formatExchanges(filtered)}`
							: "Monitor is not active.",
					},
				],
				details: { active: monitorActive, count: filtered.length, exchanges: filtered.slice(-50) },
			};
		}

		if (params.action === "stop") {
			for (const fn of cleanupFns) fn();
			cleanupFns = [];
			monitorActive = false;
			const filtered = filterExchanges(exchanges, params.urlFilter, params.methodFilter);
			const result = [...filtered];
			exchanges.length = 0;
			return {
				content: [
					{
						type: "text",
						text: `Monitor stopped. ${result.length} exchange(s):\n${formatExchanges(result)}`,
					},
				],
				details: { count: result.length, exchanges: result.slice(-100) },
			};
		}

		for (const fn of cleanupFns) fn();
		cleanupFns = [];
		exchanges.length = 0;
		monitorActive = true;

		const pending = new Map<string, { req: CapturedExchange; startTime: number }>();

		const onRequest = (request: import("playwright-core").Request) => {
			const entry: CapturedExchange = {
				url: request.url(),
				method: request.method(),
				requestHeaders: request.headers(),
				postData: request.postData(),
				status: null,
				responseHeaders: {},
				contentType: null,
				responseSize: null,
				timing: null,
				timestamp: Date.now(),
			};
			pending.set(request.url() + request.method(), { req: entry, startTime: Date.now() });
		};

		const onResponse = (response: import("playwright-core").Response) => {
			const key = response.url() + response.request().method();
			const record = pending.get(key);
			if (record) {
				record.req.status = response.status();
				record.req.responseHeaders = response.headers();
				record.req.contentType = response.headers()["content-type"] ?? null;
				record.req.timing = Date.now() - record.startTime;
				exchanges.push(record.req);
				pending.delete(key);
			} else {
				exchanges.push({
					url: response.url(),
					method: response.request().method(),
					requestHeaders: response.request().headers(),
					postData: response.request().postData(),
					status: response.status(),
					responseHeaders: response.headers(),
					contentType: response.headers()["content-type"] ?? null,
					responseSize: null,
					timing: null,
					timestamp: Date.now(),
				});
			}
		};

		page.on("request", onRequest);
		page.on("response", onResponse);
		cleanupFns.push(
			() => page.removeListener("request", onRequest),
			() => page.removeListener("response", onResponse),
		);

		return {
			content: [{ type: "text", text: "Network monitor started. Navigate or interact with the page to capture traffic." }],
			details: { active: true },
		};
	},
});

function filterExchanges(
	items: CapturedExchange[],
	urlFilter?: string,
	methodFilter?: string,
): CapturedExchange[] {
	return items.filter((e) => {
		if (urlFilter && !e.url.includes(urlFilter)) return false;
		if (methodFilter && e.method.toUpperCase() !== methodFilter.toUpperCase()) return false;
		return true;
	});
}

function formatExchanges(items: CapturedExchange[]): string {
	if (items.length === 0) return "(none)";
	return items
		.slice(-30)
		.map((e) => {
			const status = e.status !== null ? ` -> ${e.status}` : "";
			const ct = e.contentType ? ` (${e.contentType.split(";")[0]})` : "";
			const timing = e.timing !== null ? ` ${e.timing}ms` : "";
			return `${e.method} ${e.url}${status}${ct}${timing}`;
		})
		.join("\n");
}
