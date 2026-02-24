import type { OpenClawConfig } from "../../config/config.js";
import { withTimeout } from "../../node-host/with-timeout.js";

export const EMBEDDED_COMPACTION_TIMEOUT_MS = 300_000;

export function resolveCompactionTimeoutMs(cfg?: OpenClawConfig): number {
  const configured = cfg?.agents?.defaults?.compaction?.timeoutSeconds;
  if (typeof configured !== "number" || !Number.isInteger(configured) || configured <= 0) {
    return EMBEDDED_COMPACTION_TIMEOUT_MS;
  }
  return configured * 1000;
}

export async function compactWithSafetyTimeout<T>(
  compact: () => Promise<T>,
  timeoutMs: number = EMBEDDED_COMPACTION_TIMEOUT_MS,
): Promise<T> {
  return await withTimeout(() => compact(), timeoutMs, "Compaction");
}
