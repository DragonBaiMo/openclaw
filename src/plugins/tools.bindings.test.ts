import { describe, expect, it, vi } from "vitest";
import { resolvePluginTools } from "./tools.js";

const loadOpenClawPluginsMock = vi.fn();

vi.mock("./loader.js", () => ({
  loadOpenClawPlugins: () => loadOpenClawPluginsMock(),
}));

describe("resolvePluginTools bindings", () => {
  it("filters out channel plugin tools when no bindings", () => {
    loadOpenClawPluginsMock.mockReturnValue({
      tools: [
        {
          pluginId: "telegram",
          optional: false,
          source: "x",
          factory: () => ({ name: "telegram_tool" }),
        },
        {
          pluginId: "memory-core",
          optional: false,
          source: "x",
          factory: () => ({ name: "memory_tool" }),
        },
      ],
      channels: [{ pluginId: "telegram", plugin: { id: "telegram" }, source: "x" }],
      diagnostics: [],
    });

    const tools = resolvePluginTools({
      context: {
        config: { plugins: { enabled: true } },
        workspaceDir: "/tmp",
        agentId: "main",
      } as never,
    });

    expect(tools.map((t) => t.name)).toEqual(["memory_tool"]);
  });
});
