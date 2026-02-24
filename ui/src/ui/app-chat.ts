import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { scheduleChatScroll } from "./app-scroll.ts";
import { setLastActiveSessionKey } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import type { OpenClawApp } from "./app.ts";
import { abortChatRun, loadChatHistory, sendChatMessage } from "./controllers/chat.ts";
import { loadSessions } from "./controllers/sessions.ts";
import type { GatewayHelloOk } from "./gateway.ts";
import { normalizeBasePath } from "./navigation.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";

export type ChatHost = {
  connected: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatInsertNext?: ChatQueueItem | null;
  chatSkipNextQueueDrain?: boolean;
  chatActivityLeaseUntil?: number | null;
  chatRunId: string | null;
  chatSending: boolean;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  sessionKey: string;
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  refreshSessionsAfterChat: Set<string>;
  lastError?: string | null;
};

export const CHAT_SESSIONS_ACTIVE_MINUTES = 120;
export const CHAT_ACTIVITY_LEASE_MS = 12_000;

export function touchChatActivityLease(host: ChatHost, leaseMs: number = CHAT_ACTIVITY_LEASE_MS) {
  host.chatActivityLeaseUntil = Date.now() + leaseMs;
}

export function clearChatActivityLease(host: ChatHost) {
  host.chatActivityLeaseUntil = null;
}

type ChatInsertCommand = {
  isInsert: boolean;
  message: string;
};

function parseChatInsertCommand(text: string): ChatInsertCommand {
  const trimmed = text.trim();
  if (!trimmed) {
    return { isInsert: false, message: "" };
  }
  const match = trimmed.match(/^\/insert(?=$|\s|:)(?:\s+|:)?([\s\S]*)$/i);
  if (!match) {
    return { isInsert: false, message: trimmed };
  }
  return {
    isInsert: true,
    message: (match[1] ?? "").trim(),
  };
}

export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId);
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

export async function handleAbortChat(host: ChatHost) {
  if (!host.connected) {
    host.chatRunId = null;
    host.chatStream = null;
    host.chatStreamStartedAt = null;
    clearChatActivityLease(host);
    if ("lastError" in host) {
      host.lastError = "Disconnected — stop command could not reach the server. Reconnecting…";
    }
    return;
  }
  host.chatInsertNext = null;
  host.chatSkipNextQueueDrain = false;
  host.chatQueue = [];
  host.chatMessage = "";
  await abortChatRun(host as unknown as OpenClawApp);
}

function createQueueItem(params: {
  text: string;
  attachments?: ChatAttachment[];
  refreshSessions?: boolean;
  kind?: "normal" | "insert";
}): ChatQueueItem | null {
  const trimmed = params.text.trim();
  const hasAttachments = Boolean(params.attachments && params.attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return null;
  }
  return {
    id: generateUUID(),
    text: trimmed,
    createdAt: Date.now(),
    attachments: hasAttachments ? params.attachments?.map((att) => ({ ...att })) : undefined,
    refreshSessions: params.refreshSessions,
    kind: params.kind ?? "normal",
  };
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
  opts?: { priority?: "head" | "tail"; kind?: "normal" | "insert" },
) {
  const item = createQueueItem({
    text,
    attachments,
    refreshSessions,
    kind: opts?.kind,
  });
  if (!item) {
    return;
  }
  host.chatQueue =
    opts?.priority === "head" ? [item, ...host.chatQueue] : [...host.chatQueue, item];
}

function setInsertNextMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
) {
  const item = createQueueItem({
    text,
    attachments,
    refreshSessions,
    kind: "insert",
  });
  if (!item) {
    return;
  }
  host.chatInsertNext = item;
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
    skipAutoQueueDrain?: boolean;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  const runId = await sendChatMessage(host as unknown as OpenClawApp, message, opts?.attachments);
  const ok = Boolean(runId);
  if (!ok && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      host.sessionKey,
    );
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  if (ok && !host.chatRunId && !opts?.skipAutoQueueDrain) {
    void flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  return ok;
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const [next, ...rest] = host.chatQueue;
  if (!next) {
    return;
  }
  host.chatQueue = rest;
  const ok = await sendChatMessageNow(host, next.text, {
    attachments: next.attachments,
    refreshSessions: next.refreshSessions,
  });
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  }
}

export function removeQueuedMessage(host: ChatHost, id: string) {
  if (host.chatInsertNext?.id === id) {
    host.chatInsertNext = null;
    return;
  }
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: { restoreDraft?: boolean },
) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const rawMessage = (messageOverride ?? host.chatMessage).trim();
  const attachments = host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? attachments : [];
  const insertCmd = parseChatInsertCommand(rawMessage);
  const message = insertCmd.isInsert ? insertCmd.message : rawMessage;
  const hasAttachments = attachmentsToSend.length > 0;

  // Allow sending with just attachments (no message text required)
  if (!message && !hasAttachments) {
    return;
  }

  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return;
  }

  const refreshSessions = isChatResetCommand(message);
  if (messageOverride == null) {
    host.chatMessage = "";
    // Clear attachments when sending
    host.chatAttachments = [];
  }

  if (isChatBusy(host)) {
    if (insertCmd.isInsert) {
      setInsertNextMessage(host, message, attachmentsToSend, refreshSessions);
      return;
    }
    enqueueChatMessage(host, message, attachmentsToSend, refreshSessions, {
      priority: "tail",
      kind: "normal",
    });
    return;
  }

  await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
  });
}

export async function refreshChat(host: ChatHost, opts?: { scheduleScroll?: boolean }) {
  await Promise.all([
    loadChatHistory(host as unknown as OpenClawApp),
    loadSessions(host as unknown as OpenClawApp, {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
    }),
    refreshChatAvatar(host),
  ]);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  }
}

export async function flushChatQueueForEvent(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const nextInsert = host.chatInsertNext;
  if (nextInsert) {
    host.chatInsertNext = null;
    const ok = await sendChatMessageNow(host, nextInsert.text, {
      attachments: nextInsert.attachments,
      refreshSessions: nextInsert.refreshSessions,
      skipAutoQueueDrain: true,
    });
    if (!ok) {
      host.chatInsertNext = nextInsert;
      return;
    }
    host.chatSkipNextQueueDrain = true;
    return;
  }
  if (host.chatSkipNextQueueDrain) {
    host.chatSkipNextQueueDrain = false;
  }
}

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `/avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    host.chatAvatarUrl = null;
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    host.chatAvatarUrl = null;
  }
}
