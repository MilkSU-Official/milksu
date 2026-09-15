import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  readEvalDocker,
  wrapEvalDockerCommand,
} from "./bridge-eval-docker.js";

test("wraps bash so it runs inside the eval container", () => {
  const wrapped = wrapEvalDockerCommand("make test", {
    docker: "/usr/bin/docker",
    container: "milksu-eval-demo",
    workdir: "/app",
  });
  assert.equal(
    wrapped,
    `/usr/bin/docker exec -i -w "/app" "milksu-eval-demo" bash -lc "make test"`,
  );
});

test("reads eval docker files from the workspace", () => {
  const cwd = join(tmpdir(), `milksu-eval-docker-${Date.now()}`);
  mkdirSync(join(cwd, ".milksu-eval"), { recursive: true });
  writeFileSync(join(cwd, ".milksu-eval", "container"), "box-1\n");
  writeFileSync(join(cwd, ".milksu-eval", "docker"), "/bin/docker\n");
  writeFileSync(join(cwd, ".milksu-eval", "workdir"), "/app\n");
  assert.deepEqual(readEvalDocker(cwd), {
    container: "box-1",
    docker: "/bin/docker",
    workdir: "/app",
  });
});
