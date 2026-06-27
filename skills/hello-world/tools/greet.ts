import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default defineTool({
	name: "milksu_greet",
	label: "MilkSU Greet",
	description: "Generate a personalized greeting (MilkSU demo skill)",
	parameters: Type.Object({
		name: Type.String({ description: "Name to greet" }),
		style: Type.Optional(
			Type.Union([Type.Literal("formal"), Type.Literal("casual"), Type.Literal("pirate")], {
				description: "Greeting style",
				default: "casual",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const greetings: Record<string, (n: string) => string> = {
			formal: (n) => `Good day, ${n}. It is a pleasure to make your acquaintance.`,
			casual: (n) => `Hey ${n}! What's up?`,
			pirate: (n) => `Ahoy, ${n}! Welcome aboard, ye scurvy dog!`,
		};
		const style = params.style ?? "casual";
		const greetFn = greetings[style] ?? greetings.casual;

		return {
			content: [{ type: "text", text: greetFn(params.name) }],
			details: { style, name: params.name },
		};
	},
});
