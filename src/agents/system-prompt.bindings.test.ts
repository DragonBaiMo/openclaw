import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

describe("buildAgentSystemPrompt channel options by bindings", () => {
  it("omits channel option hint when agent has no channel bindings", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      config: { plugins: { enabled: true } },
      toolNames: ["message"],
      runtimeInfo: { agentId: "main" },
    });

    expect(prompt).not.toContain("If multiple channels are configured, pass `channel` (");
  });

  it("shows bound channel option hint when bindings exist", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/tmp/openclaw",
      config: {
        bindings: [{ agentId: "main", match: { channel: "telegram" } }],
      },
      toolNames: ["message"],
      runtimeInfo: { agentId: "main" },
    });

    expect(prompt).toContain("If multiple channels are configured, pass `channel` (telegram)");
  });
});
