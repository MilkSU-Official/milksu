import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { getTargets } from "./target.ts";
import fs from "node:fs";

export const reconReport = defineTool({
	name: "recon_report",
	label: "Recon Report",
	description: "Generate a structured reconnaissance report from collected target data",
	parameters: Type.Object({
		format: Type.Optional(
			Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("json")], {
				description: "Output format",
				default: "markdown",
			}),
		),
		outputPath: Type.Optional(Type.String({ description: "File path to save report (if omitted, returns inline)" })),
	}),
	async execute(_toolCallId, params) {
		const targets = getTargets();
		const format = params.format ?? "markdown";

		if (targets.size === 0) {
			return {
				content: [{ type: "text", text: "No targets registered. Use target_manage to add targets first." }],
				details: { empty: true },
			};
		}

		let report: string;

		if (format === "json") {
			report = JSON.stringify([...targets.values()], null, 2);
		} else if (format === "markdown") {
			report = generateMarkdownReport([...targets.values()]);
		} else {
			report = generateTextReport([...targets.values()]);
		}

		if (params.outputPath) {
			fs.writeFileSync(params.outputPath, report, "utf-8");
			return {
				content: [{ type: "text", text: `Report saved to ${params.outputPath} (${report.length} bytes)` }],
				details: { path: params.outputPath, format, targetCount: targets.size },
			};
		}

		return {
			content: [{ type: "text", text: report }],
			details: { format, targetCount: targets.size },
		};
	},
});

interface Target {
	id: string;
	host: string;
	label?: string;
	notes: string[];
	ports: Array<{ port: number; protocol: string; service?: string; version?: string }>;
	addedAt: string;
}

function generateMarkdownReport(targets: Target[]): string {
	const lines: string[] = [
		"# Reconnaissance Report",
		"",
		`**Generated:** ${new Date().toISOString()}`,
		`**Targets:** ${targets.length}`,
		"",
		"---",
		"",
	];

	for (const t of targets) {
		const lbl = t.label ? ` (${t.label})` : "";
		lines.push(`## ${t.host}${lbl}`);
		lines.push("");

		const openPorts = t.ports.filter((p) => !("state" in p) || (p as any).state === "open");
		if (openPorts.length > 0) {
			lines.push("### Open Ports");
			lines.push("");
			lines.push("| Port | Protocol | Service | Version |");
			lines.push("|------|----------|---------|---------|");
			for (const p of openPorts) {
				lines.push(`| ${p.port} | ${p.protocol} | ${p.service ?? "-"} | ${p.version ?? "-"} |`);
			}
			lines.push("");
		} else {
			lines.push("*No port scan data collected yet.*");
			lines.push("");
		}

		if (t.notes.length > 0) {
			lines.push("### Notes");
			lines.push("");
			for (const note of t.notes) {
				lines.push(`- ${note}`);
			}
			lines.push("");
		}

		lines.push("---");
		lines.push("");
	}

	return lines.join("\n");
}

function generateTextReport(targets: Target[]): string {
	const lines: string[] = [
		"RECONNAISSANCE REPORT",
		`Generated: ${new Date().toISOString()}`,
		`Targets: ${targets.length}`,
		"=".repeat(60),
		"",
	];

	for (const t of targets) {
		const lbl = t.label ? ` (${t.label})` : "";
		lines.push(`TARGET: ${t.host}${lbl}`);
		lines.push("-".repeat(40));

		const openPorts = t.ports;
		if (openPorts.length > 0) {
			lines.push("PORTS:");
			for (const p of openPorts) {
				const svc = p.service ?? "unknown";
				const ver = p.version ? ` ${p.version}` : "";
				lines.push(`  ${p.port}/${p.protocol}  ${svc}${ver}`);
			}
		}

		if (t.notes.length > 0) {
			lines.push("NOTES:");
			for (const note of t.notes) {
				lines.push(`  * ${note}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}
