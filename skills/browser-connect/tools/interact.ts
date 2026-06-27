import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ensureConnected } from "./connect.ts";

export const browserClick = defineTool({
	name: "browser_click",
	label: "Browser Click",
	description: "Click an element by CSS selector or page coordinates",
	parameters: Type.Object({
		selector: Type.Optional(Type.String({ description: "CSS selector of the element to click" })),
		x: Type.Optional(Type.Number({ description: "X coordinate (if no selector)" })),
		y: Type.Optional(Type.Number({ description: "Y coordinate (if no selector)" })),
		button: Type.Optional(
			Type.Union([Type.Literal("left"), Type.Literal("right"), Type.Literal("middle")], {
				description: "Mouse button",
				default: "left",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();

		if (params.selector) {
			await page.locator(params.selector).first().click({ button: params.button ?? "left" });
			return {
				content: [{ type: "text", text: `Clicked: ${params.selector}` }],
				details: { selector: params.selector },
			};
		}

		if (params.x !== undefined && params.y !== undefined) {
			await page.mouse.click(params.x, params.y, { button: params.button ?? "left" });
			return {
				content: [{ type: "text", text: `Clicked at (${params.x}, ${params.y})` }],
				details: { x: params.x, y: params.y },
			};
		}

		return {
			content: [{ type: "text", text: "Provide either selector or x+y coordinates" }],
			details: { error: "missing param" },
		};
	},
});

export const browserType = defineTool({
	name: "browser_type",
	label: "Browser Type",
	description: "Type text into an input field identified by CSS selector",
	parameters: Type.Object({
		selector: Type.String({ description: "CSS selector of the input element" }),
		text: Type.String({ description: "Text to type" }),
		clear: Type.Optional(Type.Boolean({ description: "Clear existing content before typing", default: true })),
		pressEnter: Type.Optional(Type.Boolean({ description: "Press Enter after typing", default: false })),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();
		const locator = page.locator(params.selector).first();

		if (params.clear ?? true) {
			await locator.fill(params.text);
		} else {
			await locator.pressSequentially(params.text);
		}

		if (params.pressEnter) {
			await locator.press("Enter");
		}

		return {
			content: [{ type: "text", text: `Typed "${params.text}" into ${params.selector}${params.pressEnter ? " + Enter" : ""}` }],
			details: { selector: params.selector, text: params.text },
		};
	},
});

export const browserEvaluate = defineTool({
	name: "browser_evaluate",
	label: "Browser Evaluate",
	description: "Execute JavaScript in the current page context and return the result",
	parameters: Type.Object({
		expression: Type.String({ description: "JavaScript expression or code to evaluate" }),
	}),
	async execute(_toolCallId, params) {
		const { page } = await ensureConnected();

		try {
			const result = await page.evaluate(params.expression);
			const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);

			return {
				content: [{ type: "text", text: text ?? "(undefined)" }],
				details: { type: typeof result },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Evaluation error: ${msg}` }],
				details: { error: msg },
			};
		}
	},
});
