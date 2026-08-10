import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const backgroundAuthorization = Symbol("milksu.background-task.authorization");
const backgroundAuthorizationEnvironment = "MILKSU_BACKGROUND_AUTHORIZATION";
const maxRetainedAuthorizations = 256;
const retainedAuthorizations = new Map();
let activeResumeAuthorization;

function normalizedEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([name]) => name !== backgroundAuthorizationEnvironment)
    .map(([name, entry]) => [String(name), String(entry)])
    .sort(([left], [right]) => left.localeCompare(right));
}

function normalizedSpecification(specification, authorization) {
  return JSON.stringify({
    command: typeof specification?.command === "string" ? specification.command : null,
    argv: Array.isArray(specification?.argv)
      ? specification.argv.map(value => String(value))
      : null,
    shell: specification?.shell !== false,
    cwd: String(specification?.cwd || authorization?.cwd || ""),
    env: normalizedEnvironment(specification?.env),
  });
}

function freezeAuthorization(authorization) {
  return Object.freeze({
    ...authorization,
    readableRoots: Object.freeze([...(authorization?.readableRoots || [])]),
  });
}

function retainAuthorization(token, record) {
  retainedAuthorizations.set(token, record);
  while (retainedAuthorizations.size > maxRetainedAuthorizations) {
    retainedAuthorizations.delete(retainedAuthorizations.keys().next().value);
  }
}

function authorizationRecord(specification) {
  const direct = specification?.[backgroundAuthorization];
  if (direct?.authorization) return direct;
  const token = specification?.env?.[backgroundAuthorizationEnvironment];
  return typeof token === "string" ? retainedAuthorizations.get(token) : undefined;
}

export function authorizeBackgroundToolInput(input, authorization) {
  if (!input || typeof input !== "object") {
    throw new Error("MilkSU background authorization requires an object input");
  }
  const frozen = freezeAuthorization(authorization);
  const token = randomUUID();
  input.env = {
    ...(input.env && typeof input.env === "object" && !Array.isArray(input.env)
      ? input.env
      : {}),
    [backgroundAuthorizationEnvironment]: token,
  };
  const record = Object.freeze({
    authorization: frozen,
    specification: normalizedSpecification(input, frozen),
  });
  retainAuthorization(token, record);
  Object.defineProperty(input, backgroundAuthorization, {
    configurable: false,
    enumerable: true,
    value: record,
    writable: false,
  });
}

export function readBackgroundAuthorization(specification) {
  const record = authorizationRecord(specification);
  const authorization = record?.authorization;
  if (
    !authorization
    || typeof authorization !== "object"
    || typeof authorization.workspace !== "string"
    || typeof authorization.cwd !== "string"
    || !["workspace-auto", "full-auto"].includes(authorization.mode)
  ) {
    throw new Error(
      "MilkSU denied an unauthorised background process; start it through the reviewed Coding tools",
    );
  }
  if (record.specification !== normalizedSpecification(specification, authorization)) {
    throw new Error(
      "MilkSU denied a background process whose command changed after authorization",
    );
  }
  return authorization;
}

export async function withBackgroundResumeAuthorization(authorization, callback) {
  const previous = activeResumeAuthorization;
  activeResumeAuthorization = freezeAuthorization(authorization);
  try {
    return await callback();
  } finally {
    activeResumeAuthorization = previous;
  }
}

export function authorizeResumedBackgroundSpecification(specification) {
  const scope = activeResumeAuthorization;
  if (!scope) {
    throw new Error(
      "MilkSU denied background task recovery outside a reviewed session start",
    );
  }
  const requested = typeof specification?.cwd === "string" && specification.cwd.trim()
    ? specification.cwd.trim()
    : scope.cwd;
  const candidate = isAbsolute(requested)
    ? requested
    : resolve(scope.workspace, requested);
  const cwd = realpathSync(candidate);
  const workspace = realpathSync(scope.workspace);
  const path = relative(workspace, cwd);
  if (
    scope.mode !== "full-auto"
    && (
      path === ".."
      || path.startsWith(`..${sep}`)
      || isAbsolute(path)
    )
  ) {
    throw new Error(
      "MilkSU denied recovery of a background task outside the selected project",
    );
  }
  specification.cwd = cwd;
  authorizeBackgroundToolInput(specification, {
    ...scope,
    workspace,
    cwd,
  });
}
