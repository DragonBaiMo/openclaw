export type HeartbeatIndicatorType = "ok" | "alert" | "error";

export type HeartbeatEventPayload = {
  ts: number;
  agentId?: string;
  status: "sent" | "ok-empty" | "ok-token" | "skipped" | "failed";
  to?: string;
  accountId?: string;
  preview?: string;
  durationMs?: number;
  hasMedia?: boolean;
  reason?: string;
  /** The channel this heartbeat was sent to. */
  channel?: string;
  /** Whether the message was silently suppressed (showOk: false). */
  silent?: boolean;
  /** Indicator type for UI status display. */
  indicatorType?: HeartbeatIndicatorType;
};

export function resolveIndicatorType(
  status: HeartbeatEventPayload["status"],
): HeartbeatIndicatorType | undefined {
  switch (status) {
    case "ok-empty":
    case "ok-token":
      return "ok";
    case "sent":
      return "alert";
    case "failed":
      return "error";
    case "skipped":
      return undefined;
  }
}

let lastHeartbeat: HeartbeatEventPayload | null = null;
const lastHeartbeatByAgent = new Map<string, HeartbeatEventPayload>();
const listeners = new Set<(evt: HeartbeatEventPayload) => void>();

function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase();
}

export function emitHeartbeatEvent(evt: Omit<HeartbeatEventPayload, "ts">) {
  const enriched: HeartbeatEventPayload = { ts: Date.now(), ...evt };
  lastHeartbeat = enriched;
  if (typeof enriched.agentId === "string" && enriched.agentId.trim()) {
    lastHeartbeatByAgent.set(normalizeAgentId(enriched.agentId), enriched);
  }
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onHeartbeatEvent(listener: (evt: HeartbeatEventPayload) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLastHeartbeatEvent(): HeartbeatEventPayload | null {
  return lastHeartbeat;
}

export function getLastHeartbeatEventForAgent(agentId: string): HeartbeatEventPayload | null {
  const normalized = normalizeAgentId(agentId);
  return lastHeartbeatByAgent.get(normalized) ?? null;
}
