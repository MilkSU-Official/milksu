import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default defineTool({
	name: "panel_update",
	label: "Update Task Panel",
	description:
		"Push structured data to the task panel sidebar. Use set_fields to overwrite scalar values (target, phase, binary, solved). Use append_items to add entries to array fields (ports, vulnerabilities, flags, hosts, findings, functions, tools_used, scope, hints). Both parameters are optional but at least one must be provided.",
	parameters: Type.Object({
		set_fields: Type.Optional(
			Type.Record(Type.String(), Type.Any(), {
				description:
					"Key-value pairs to set (overwrites). Example: { target: '10.0.0.1', phase: 2 }",
			}),
		),
		append_items: Type.Optional(
			Type.Record(Type.String(), Type.Array(Type.Any()), {
				description:
					"Key-array pairs to append. Example: { ports: [{ port: 22, service: 'ssh', state: 'open' }] }",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const fieldCount = Object.keys(params.set_fields ?? {}).length;
		const appendCount = Object.values(params.append_items ?? {}).reduce(
			(sum, arr) => sum + arr.length,
			0,
		);
		return {
			content: [
				{
					type: "text",
					text: `Panel updated: ${fieldCount} field(s) set, ${appendCount} item(s) appended.`,
				},
			],
			details: {
				panel_update: true,
				set_fields: params.set_fields ?? {},
				append_items: params.append_items ?? {},
			},
		};
	},
});
