import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export interface Target {
	id: string;
	host: string;
	label?: string;
	notes: string[];
	ports: Array<{ port: number; protocol: string; service?: string; version?: string }>;
	addedAt: string;
}

const targets = new Map<string, Target>();

export function getTargets(): Map<string, Target> {
	return targets;
}

export const targetManage = defineTool({
	name: "target_manage",
	label: "Target Manage",
	description: "Register, list, update, or remove penetration test targets",
	parameters: Type.Object({
		action: Type.Union(
			[Type.Literal("add"), Type.Literal("list"), Type.Literal("remove"), Type.Literal("note")],
			{ description: "Action to perform" },
		),
		host: Type.Optional(Type.String({ description: "Target IP or hostname (for add/remove/note)" })),
		label: Type.Optional(Type.String({ description: "Friendly label (for add)" })),
		note: Type.Optional(Type.String({ description: "Note to attach (for note action)" })),
	}),
	async execute(_toolCallId, params) {
		switch (params.action) {
			case "add": {
				if (!params.host) {
					return { content: [{ type: "text", text: "host is required for add" }], details: { error: true } };
				}
				const id = params.host.replace(/[^a-zA-Z0-9.-]/g, "_");
				const existing = targets.get(id);
				if (existing) {
					return {
						content: [{ type: "text", text: `Target ${params.host} already registered` }],
						details: { target: existing },
					};
				}
				const target: Target = {
					id,
					host: params.host,
					label: params.label,
					notes: [],
					ports: [],
					addedAt: new Date().toISOString(),
				};
				targets.set(id, target);
				return {
					content: [{ type: "text", text: `Target registered: ${params.host}${params.label ? ` (${params.label})` : ""}` }],
					details: { target },
				};
			}

			case "list": {
				if (targets.size === 0) {
					return { content: [{ type: "text", text: "No targets registered" }], details: { targets: [] } };
				}
				const lines = [...targets.values()].map((t) => {
					const lbl = t.label ? ` (${t.label})` : "";
					const portCount = t.ports.length;
					return `${t.host}${lbl} — ${portCount} known port(s), ${t.notes.length} note(s)`;
				});
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { targets: [...targets.values()] },
				};
			}

			case "remove": {
				if (!params.host) {
					return { content: [{ type: "text", text: "host is required for remove" }], details: { error: true } };
				}
				const id = params.host.replace(/[^a-zA-Z0-9.-]/g, "_");
				const removed = targets.delete(id);
				return {
					content: [{ type: "text", text: removed ? `Removed ${params.host}` : `Target ${params.host} not found` }],
					details: { removed },
				};
			}

			case "note": {
				if (!params.host || !params.note) {
					return { content: [{ type: "text", text: "host and note are required" }], details: { error: true } };
				}
				const id = params.host.replace(/[^a-zA-Z0-9.-]/g, "_");
				const target = targets.get(id);
				if (!target) {
					return { content: [{ type: "text", text: `Target ${params.host} not found` }], details: { error: true } };
				}
				target.notes.push(params.note);
				return {
					content: [{ type: "text", text: `Note added to ${params.host}: ${params.note}` }],
					details: { target },
				};
			}
		}
	},
});
