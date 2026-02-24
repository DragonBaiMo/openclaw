import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { getAgentBoundChannels } from "./bindings.js";

describe("getAgentBoundChannels", () => {
  it("returns empty set when no bindings", () => {
    const cfg: OpenClawConfig = {};
    expect(Array.from(getAgentBoundChannels(cfg, "main"))).toEqual([]);
  });

  it("returns union of channels bound to the agent", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { agentId: "main", match: { channel: "telegram" } },
        { agentId: "main", match: { channel: "discord" } },
      ],
    };
    expect(Array.from(getAgentBoundChannels(cfg, "main")).toSorted()).toEqual([
      "discord",
      "telegram",
    ]);
  });
});
