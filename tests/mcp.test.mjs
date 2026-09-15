import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

function runServer(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/index.mjs"], { cwd: new URL("..", import.meta.url) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`server exited ${code}: ${stderr}`));
      resolve(stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
    });
    messages.forEach((message) => child.stdin.write(`${JSON.stringify(message)}\n`));
    child.stdin.end();
  });
}

test("MCP server lists and executes the planning tool", async () => {
  const fixture = JSON.parse(await readFile(new URL("../fixtures/urgent-trip.json", import.meta.url), "utf8"));
  const responses = await runServer([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_enroute_meal", arguments: fixture } },
  ]);
  assert.equal(responses.find((item) => item.id === 1)?.result.serverInfo.name, "road-food-planner");
  assert.equal(responses.find((item) => item.id === 2)?.result.tools[0].name, "plan_enroute_meal");
  assert.equal(responses.find((item) => item.id === 3)?.result.structuredContent.computed.tripMode, "urgent");
});
