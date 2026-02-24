import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { hydrateSendAttachmentParams } from "./message-action-params.js";

describe("hydrateSendAttachmentParams", () => {
  const stateDirEnvKey = "OPENCLAW_STATE_DIR";
  const prevStateDir = process.env[stateDirEnvKey];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses local media paths outside allowed roots", async () => {
    const cfg: OpenClawConfig = { agents: { list: [{ id: "ops" }] } };
    const args: Record<string, unknown> = {
      action: "sendAttachment",
      channel: "telegram",
      to: "-100123",
      media: path.join(os.tmpdir(), "blocked", "file.txt"),
    };

    await expect(
      hydrateSendAttachmentParams({
        cfg,
        channel: "telegram",
        accountId: null,
        agentId: "ops",
        args,
        action: "sendAttachment",
        dryRun: false,
      }),
    ).rejects.toThrow();
  });

  it("uses safe local file read for allowed roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-state-test-"));
    process.env[stateDirEnvKey] = root;

    const allowedDir = path.join(root, "media", "allowed");
    await fs.mkdir(allowedDir, { recursive: true });
    const filePath = path.join(allowedDir, "hello.txt");
    await fs.writeFile(filePath, "hello", "utf8");

    const cfg: OpenClawConfig = { agents: { list: [{ id: "ops" }] } };
    const args: Record<string, unknown> = {
      action: "sendAttachment",
      channel: "telegram",
      to: "-100123",
      media: filePath,
    };

    const readSpy = vi.spyOn(fs, "readFile");
    try {
      await hydrateSendAttachmentParams({
        cfg,
        channel: "telegram",
        accountId: null,
        agentId: "ops",
        args,
        action: "sendAttachment",
        dryRun: false,
      });
    } finally {
      if (prevStateDir === undefined) {
        delete process.env[stateDirEnvKey];
      } else {
        process.env[stateDirEnvKey] = prevStateDir;
      }
    }

    expect(typeof args.buffer).toBe("string");
    expect((args.buffer as string).length).toBeGreaterThan(0);
    expect(readSpy).not.toHaveBeenCalled();
  });
});
