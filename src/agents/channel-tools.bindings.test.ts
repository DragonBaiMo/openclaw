import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { listChannelAgentTools } from "./channel-tools.js";

const listChannelPluginsMock = vi.fn();
const getAgentBoundChannelsMock = vi.fn();

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => listChannelPluginsMock(),
}));

vi.mock("../routing/bindings.js", async () => {
  const actual =
    await vi.importActual<typeof import("../routing/bindings.js")>("../routing/bindings.js");
  return {
    ...actual,
    getAgentBoundChannels: (cfg: OpenClawConfig, agentId: string | undefined) =>
      getAgentBoundChannelsMock(cfg, agentId),
  };
});

describe("listChannelAgentTools bindings", () => {
  beforeEach(() => {
    listChannelPluginsMock.mockReset();
    getAgentBoundChannelsMock.mockReset();
    listChannelPluginsMock.mockReturnValue([
      { id: "telegram", agentTools: [{ name: "telegram_login" }] },
      { id: "discord", agentTools: [{ name: "discord_login" }] },
    ]);
    getAgentBoundChannelsMock.mockReturnValue(new Set());
  });

  it("returns empty tools when no channel bindings", () => {
    const tools = listChannelAgentTools({
      cfg: { plugins: { enabled: true } } as OpenClawConfig,
      agentId: "main",
    });
    expect(tools).toEqual([]);
  });

  it("returns only tools for bound channels", () => {
    getAgentBoundChannelsMock.mockReturnValue(new Set(["telegram"]));
    const tools = listChannelAgentTools({ cfg: {} as OpenClawConfig, agentId: "main" });
    expect(tools.map((t) => t.name)).toEqual(["telegram_login"]);
  });
});
