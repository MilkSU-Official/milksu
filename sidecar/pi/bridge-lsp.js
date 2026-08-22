import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createTwoFilesPatch } from "diff";

const approvalDiffLimit = 60_000;
const toolDiffLimit = 60_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function within(root, target) {
  const path = relative(root, target);
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function truncate(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n… MilkSU truncated this Diff …`;
}

async function reviewedFile(workspace, path) {
  const root = await realpath(workspace);
  const target = await realpath(resolve(root, path));
  if (!within(root, target)) {
    throw new Error(`MilkSU LSP fix denied path outside the workspace: ${path}`);
  }
  return {
    absolutePath: target,
    relativePath: relative(root, target).replaceAll("\\", "/"),
  };
}

function textResult(text, details) {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function reviewedDiff(path, before, after) {
  return createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    before,
    after,
    "current",
    "proposed",
    { context: 3 },
  );
}

export function createReviewedLspFixTool(
  tool,
  {
    conversationId,
    getPolicy,
    approvalBroker,
  },
) {
  return {
    ...tool,
    description: "Preview and apply an LSP source fix inside the current workspace. "
      + "MilkSU shows a unified Diff before approval in Request Approval mode and verifies "
      + "that the applied file exactly matches the reviewed proposal.",
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      "Set write=true when the user asked to apply the fix. MilkSU computes a dry-run first, "
        + "shows the exact Diff when approval is required, and aborts if the file changes before apply.",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const policy = getPolicy();
      if (
        !policy
        || policy.executionMode !== "go"
        || !["ask", "workspace-auto", "full-auto"].includes(policy.approvalPolicy)
        || !policy.activeTools.includes("lsp_fix")
      ) {
        throw new Error("MilkSU Coding policy does not allow lsp_fix in this task");
      }

      const preview = await tool.execute(
        toolCallId,
        {
          ...params,
          root: policy.workspace,
          write: false,
        },
        signal,
        onUpdate,
        ctx,
      );
      const details = preview?.details;
      if (!details || typeof details !== "object") {
        throw new Error("MilkSU could not inspect the LSP fix preview");
      }
      const path = String(details.path ?? params.path ?? "").trim();
      const file = await reviewedFile(policy.workspace, path);
      const before = await readFile(file.absolutePath, "utf8");
      const proposed = typeof details.text === "string" ? details.text : before;
      const changed = proposed !== before;
      const diff = changed
        ? reviewedDiff(file.relativePath, before, proposed)
        : "";
      const resultDetails = {
        ...details,
        path: file.relativePath,
        reviewed: true,
        write: false,
        diff: truncate(diff, toolDiffLimit),
        beforeSha256: sha256(before),
        afterSha256: sha256(proposed),
      };

      if (!changed) {
        return textResult(
          `LSP found no applicable source fix for ${file.relativePath}.`,
          resultDetails,
        );
      }
      if (params.write !== true) {
        return textResult(
          `LSP previewed a source fix for ${file.relativePath}; no files were changed.\n\n`
            + truncate(diff, toolDiffLimit),
          resultDetails,
        );
      }

      if (policy.approvalPolicy === "ask") {
        if (diff.length > approvalDiffLimit) {
          throw new Error(
            `MilkSU did not request approval because the LSP Diff for ${file.relativePath} `
              + `exceeds the ${approvalDiffLimit}-character review limit`,
          );
        }
        const approved = await approvalBroker.request({
          conversationId,
          toolName: "lsp_fix",
          content: `LSP 修复 · ${file.relativePath}\n\n${diff}`,
          input: JSON.stringify({
            path: file.relativePath,
            kind: String(params.kind ?? "source.fixAll"),
            server: params.server ? String(params.server) : undefined,
            beforeSha256: resultDetails.beforeSha256,
            afterSha256: resultDetails.afterSha256,
          }, null, 2),
        });
        if (!approved) {
          throw new Error("MilkSU user denied lsp_fix");
        }
      }

      const current = await readFile(file.absolutePath, "utf8");
      if (sha256(current) !== resultDetails.beforeSha256) {
        throw new Error(
          `MilkSU did not apply the LSP fix because ${file.relativePath} changed after preview`,
        );
      }

      await tool.execute(
        toolCallId,
        {
          ...params,
          root: policy.workspace,
          path: file.relativePath,
          write: true,
        },
        signal,
        onUpdate,
        ctx,
      );
      const applied = await readFile(file.absolutePath, "utf8");
      if (applied !== proposed) {
        await writeFile(file.absolutePath, before, "utf8");
        throw new Error(
          `MilkSU rolled back ${file.relativePath} because the applied LSP fix `
            + "did not match the reviewed Diff",
        );
      }

      return textResult(
        `LSP applied the reviewed source fix to ${file.relativePath}.\n\n`
          + truncate(diff, toolDiffLimit),
        {
          ...resultDetails,
          write: true,
        },
      );
    },
  };
}

export function createReviewedLspExtension(piLspExtension, options) {
  return (pi) => {
    const reviewedApi = new Proxy(pi, {
      get(target, property, receiver) {
        if (property === "registerTool") {
          return (tool) => target.registerTool(
            tool?.name === "lsp_fix"
              ? createReviewedLspFixTool(tool, options)
              : tool,
          );
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    piLspExtension(reviewedApi);
  };
}
