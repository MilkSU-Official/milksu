import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const nmapScan = defineTool({
	name: "nmap_scan",
	label: "Nmap Scan",
	description: "Run nmap port scan against a target with structured output",
	executionMode: "sequential",
	parameters: Type.Object({
		target: Type.String({ description: "Target IP, hostname, or CIDR range" }),
		ports: Type.Optional(Type.String({ description: "Port specification (e.g. '80,443', '1-1000', '-' for all)" })),
		scanType: Type.Optional(
			Type.Union(
				[
					Type.Literal("quick"),
					Type.Literal("service"),
					Type.Literal("os"),
					Type.Literal("vuln"),
					Type.Literal("stealth"),
				],
				{ description: "Scan preset", default: "quick" },
			),
		),
		extraArgs: Type.Optional(Type.Array(Type.String(), { description: "Additional nmap arguments" })),
	}),
	async execute(_toolCallId, params) {
		const args: string[] = [];

		switch (params.scanType ?? "quick") {
			case "quick":
				args.push("-T4", "-F");
				break;
			case "service":
				args.push("-sV", "--version-intensity", "5");
				break;
			case "os":
				args.push("-O", "-sV");
				break;
			case "vuln":
				args.push("-sV", "--script", "vuln");
				break;
			case "stealth":
				args.push("-sS", "-T2");
				break;
		}

		if (params.ports) {
			args.push("-p", params.ports);
		}

		args.push("-oX", "-");

		if (params.extraArgs) {
			args.push(...params.extraArgs);
		}

		args.push(params.target);

		try {
			const { stdout, stderr } = await execFileAsync("nmap", args, { timeout: 300000 });
			const parsed = parseNmapXml(stdout);

			const summary = formatScanSummary(parsed);

			return {
				content: [{ type: "text", text: summary }],
				details: { raw: stdout, parsed, stderr: stderr || undefined },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `Nmap scan failed: ${msg}\n\nMake sure nmap is installed.` }],
				details: { error: msg },
			};
		}
	},
});

interface NmapHost {
	address: string;
	hostname?: string;
	state: string;
	ports: NmapPort[];
}

interface NmapPort {
	port: number;
	protocol: string;
	state: string;
	service?: string;
	version?: string;
}

function parseNmapXml(xml: string): NmapHost[] {
	const hosts: NmapHost[] = [];
	const hostMatches = xml.matchAll(/<host\b[^>]*>([\s\S]*?)<\/host>/g);

	for (const hostMatch of hostMatches) {
		const hostXml = hostMatch[1];

		const addrMatch = hostXml.match(/<address addr="([^"]+)"/);
		const hostnameMatch = hostXml.match(/<hostname name="([^"]+)"/);
		const stateMatch = hostXml.match(/<status state="([^"]+)"/);

		if (!addrMatch) continue;

		const ports: NmapPort[] = [];
		const portMatches = hostXml.matchAll(/<port protocol="([^"]+)" portid="(\d+)">([\s\S]*?)<\/port>/g);

		for (const portMatch of portMatches) {
			const portXml = portMatch[3];
			const portStateMatch = portXml.match(/<state state="([^"]+)"/);
			const serviceMatch = portXml.match(/<service name="([^"]*)"(?:[^>]*product="([^"]*)")?(?:[^>]*version="([^"]*)")?/);

			ports.push({
				protocol: portMatch[1],
				port: parseInt(portMatch[2]),
				state: portStateMatch?.[1] ?? "unknown",
				service: serviceMatch?.[1],
				version: [serviceMatch?.[2], serviceMatch?.[3]].filter(Boolean).join(" ") || undefined,
			});
		}

		hosts.push({
			address: addrMatch[1],
			hostname: hostnameMatch?.[1],
			state: stateMatch?.[1] ?? "unknown",
			ports,
		});
	}

	return hosts;
}

function formatScanSummary(hosts: NmapHost[]): string {
	if (hosts.length === 0) return "No hosts found.";

	const lines: string[] = [];

	for (const host of hosts) {
		const name = host.hostname ? `${host.address} (${host.hostname})` : host.address;
		lines.push(`Host: ${name} [${host.state}]`);

		const openPorts = host.ports.filter((p) => p.state === "open");
		if (openPorts.length === 0) {
			lines.push("  No open ports found");
		} else {
			lines.push(`  ${openPorts.length} open port(s):`);
			for (const p of openPorts) {
				const svc = p.service ?? "unknown";
				const ver = p.version ? ` (${p.version})` : "";
				lines.push(`  ${p.port}/${p.protocol}  ${svc}${ver}`);
			}
		}
		lines.push("");
	}

	return lines.join("\n");
}
