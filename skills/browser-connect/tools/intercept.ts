import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";
import type { Route, Request } from "playwright-core";

interface InterceptedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	postData: string | null;
	resourceType: string;
	timestamp: number;
}

const interceptLog: InterceptedRequest[] = [];
let interceptActive = false;

export const browserIntercept = defineTool({
	name: "browser_intercept",
	label: "Browser Intercept",
	description:
		"Start or stop HTTP request interception on the current page. When active, all requests are logged. Optionally block requests by URL pattern or modify request headers. Call with action 'start' to begin, 'stop' to end and get the log, or 'log' to read the current log without stopping.",
	parameters: Type.Object({
		action: Type.Union(
			[Type.Literal("start"), Type.Literal("stop"), Type.Literal("log")],
			{ description: "start: begin intercepting, stop: end and return log, log: read log" },
		),
		blockPatterns: Type.Optional(
			Type.Array(Type.String(), {
				description: "URL substrings to block (e.g., ['analytics', 'tracking']). Only used with 'start'.",
			}),
		),
		modifyHeaders: Type.Optional(
			Type.Record(Type.String(), Type.String(), {
				description: "Headers to add/override on outgoing requests. Only used with 'start'.",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();

		if (params.action === "log") {
			return {
				content: [
					{
						type: "text",
						text: interceptActive
							? `Intercepting. ${interceptLog.length} request(s) captured:\n${formatLog(interceptLog)}`
							: "Interception is not active.",
					},
				],
				details: { active: interceptActive, count: interceptLog.length, requests: interceptLog.slice(-50) },
			};
		}

		if (params.action === "stop") {
			await page.unrouteAll({ behavior: "ignoreErrors" });
			interceptActive = false;
			const log = [...interceptLog];
			interceptLog.length = 0;
			return {
				content: [
					{
						type: "text",
						text: `Interception stopped. ${log.length} request(s) captured:\n${formatLog(log)}`,
					},
				],
				details: { count: log.length, requests: log.slice(-100) },
			};
		}

		if (interceptActive) {
			await page.unrouteAll({ behavior: "ignoreErrors" });
		}
		interceptLog.length = 0;
		interceptActive = true;

		const blockPatterns = params.blockPatterns ?? [];
		const modifyHeaders = params.modifyHeaders ?? {};

		await page.route("**/*", async (route: Route, request: Request) => {
			interceptLog.push({
				url: request.url(),
				method: request.method(),
				headers: request.headers(),
				postData: request.postData(),
				resourceType: request.resourceType(),
				timestamp: Date.now(),
			});

			const shouldBlock = blockPatterns.some((pattern) => request.url().includes(pattern));
			if (shouldBlock) {
				await route.abort("blockedbyclient");
				return;
			}

			if (Object.keys(modifyHeaders).length > 0) {
				const headers = { ...request.headers(), ...modifyHeaders };
				await route.continue({ headers });
				return;
			}

			await route.continue();
		});

		return {
			content: [
				{
					type: "text",
					text: `Interception started.${blockPatterns.length > 0 ? ` Blocking: ${blockPatterns.join(", ")}` : ""}${Object.keys(modifyHeaders).length > 0 ? ` Modifying headers: ${Object.keys(modifyHeaders).join(", ")}` : ""}`,
				},
			],
			details: { active: true, blockPatterns, modifyHeaders },
		};
	},
});

function formatLog(log: InterceptedRequest[]): string {
	if (log.length === 0) return "(none)";
	return log
		.slice(-30)
		.map((r) => `${r.method} ${r.url}${r.postData ? " [has body]" : ""}`)
		.join("\n");
}
