import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { resolvePluginSkillDirs } from "./plugin-skills.js";

const tempDirs: string[] = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-plugin-skills-"));
  tempDirs.push(dir);
  return dir;
}

function createPlugin(params: { workspaceDir: string; id: string; channels?: string[] }) {
  const root = path.join(params.workspaceDir, ".openclaw", "extensions", params.id);
  fs.mkdirSync(path.join(root, "skills", "demo"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.js"), "export default {};\n", "utf-8");
  fs.writeFileSync(
    path.join(root, "openclaw.plugin.json"),
    JSON.stringify({
      id: params.id,
      configSchema: { type: "object" },
      channels: params.channels ?? [],
      skills: ["skills"],
    }),
    "utf-8",
  );
  fs.writeFileSync(path.join(root, "skills", "demo", "SKILL.md"), "# demo\n", "utf-8");
  return path.join(root, "skills");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("resolvePluginSkillDirs bindings", () => {
  it("hides channel plugin skills when no bindings", () => {
    const workspaceDir = makeTempDir();
    const telegramSkills = createPlugin({
      workspaceDir,
      id: "telegram",
      channels: ["telegram"],
    });
    const memorySkills = createPlugin({ workspaceDir, id: "memory-core" });

    const config: OpenClawConfig = { plugins: { enabled: true } };
    const dirs = resolvePluginSkillDirs({ workspaceDir, config, agentId: "main" });

    expect(dirs).toEqual([memorySkills]);
    expect(dirs).not.toContain(telegramSkills);
  });
});
