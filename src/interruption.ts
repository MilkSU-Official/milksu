import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function setupInterruptionHandler(pi: ExtensionAPI) {
	pi.on("input", (event) => {
		if (event.streamingBehavior === "steer") {
			return {
				action: "transform" as const,
				text: `[user interrupt] ${event.text}`,
				images: event.images,
			};
		}
	});
}
