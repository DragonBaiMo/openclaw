import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  compactWithSafetyTimeout,
  EMBEDDED_COMPACTION_TIMEOUT_MS,
  resolveCompactionTimeoutMs,
} from "./pi-embedded-runner/compaction-safety-timeout.js";

describe("compactWithSafetyTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with timeout when compaction never settles", async () => {
    vi.useFakeTimers();
    const compactPromise = compactWithSafetyTimeout(() => new Promise<never>(() => {}));
    const timeoutAssertion = expect(compactPromise).rejects.toThrow("Compaction timed out");

    await vi.advanceTimersByTimeAsync(EMBEDDED_COMPACTION_TIMEOUT_MS);
    await timeoutAssertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns result and clears timer when compaction settles first", async () => {
    vi.useFakeTimers();
    const compactPromise = compactWithSafetyTimeout(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 10)),
      30,
    );

    await vi.advanceTimersByTimeAsync(10);
    await expect(compactPromise).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves compaction errors and clears timer", async () => {
    vi.useFakeTimers();
    const error = new Error("provider exploded");

    await expect(
      compactWithSafetyTimeout(async () => {
        throw error;
      }, 30),
    ).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns embedded default when compaction timeout is not configured", () => {
    expect(resolveCompactionTimeoutMs(undefined)).toBe(EMBEDDED_COMPACTION_TIMEOUT_MS);
    expect(resolveCompactionTimeoutMs({})).toBe(EMBEDDED_COMPACTION_TIMEOUT_MS);
  });

  it("returns configured timeoutSeconds in milliseconds", () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          compaction: {
            timeoutSeconds: 600,
          },
        },
      },
    };
    expect(resolveCompactionTimeoutMs(cfg)).toBe(600_000);
  });

  it("falls back to default for non-positive timeoutSeconds", () => {
    const cfg: OpenClawConfig = {
      agents: {
        defaults: {
          compaction: {
            timeoutSeconds: 0,
          },
        },
      },
    };
    expect(resolveCompactionTimeoutMs(cfg)).toBe(EMBEDDED_COMPACTION_TIMEOUT_MS);
  });
});
