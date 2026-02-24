import path from "node:path";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { parseModelRef } from "../../agents/model-selection.js";
import {
  abortEmbeddedPiRun,
  compactEmbeddedPiSession,
  isEmbeddedPiRunActive,
  type EmbeddedPiCompactResult,
  waitForEmbeddedPiRunEnd,
} from "../../agents/pi-embedded.js";
import { cleanStaleLockFiles } from "../../agents/session-write-lock.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  resolveFreshSessionTotalTokens,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { emitAgentEvent } from "../../infra/agent-events.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { formatContextUsageShort, formatTokenCount } from "../status.js";
import type { CommandHandler } from "./commands-types.js";
import { stripMentions, stripStructuralPrefixes } from "./mentions.js";
import { incrementCompactionCount } from "./session-updates.js";

const MANUAL_COMPACTION_TIMEOUT_MS = 180_000;
const MANUAL_COMPACTION_LOCK_STALE_MS = 60_000;
const MANUAL_COMPACTION_ABORT_GRACE_MS = 15_000;

type ManualCompactionOutcome = {
  result: EmbeddedPiCompactResult;
  timedOut: boolean;
};

function resolveManualCompactionTimeoutMs(cfg: OpenClawConfig): number {
  const configured = cfg.agents?.defaults?.compaction?.timeoutSeconds;
  if (typeof configured !== "number" || !Number.isInteger(configured) || configured <= 0) {
    return MANUAL_COMPACTION_TIMEOUT_MS;
  }
  return configured * 1000;
}

function resolveManualCompactionModel(params: {
  cfg: OpenClawConfig;
  provider?: string;
  model?: string;
}): { provider: string; model: string } {
  const provider = (params.provider ?? DEFAULT_PROVIDER).trim() || DEFAULT_PROVIDER;
  const model = (params.model ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const configured = params.cfg.agents?.defaults?.compaction?.model;
  if (typeof configured !== "string") {
    return { provider, model };
  }
  const parsed = parseModelRef(configured, provider);
  if (!parsed) {
    logVerbose(`Ignoring invalid agents.defaults.compaction.model: ${configured}`);
    return { provider, model };
  }
  return { provider: parsed.provider, model: parsed.model };
}

function withManualCompactionTimeout(
  work: Promise<EmbeddedPiCompactResult>,
  timeoutMs: number,
): Promise<ManualCompactionOutcome> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<ManualCompactionOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        result: {
          ok: false,
          compacted: false,
          reason: `timed out after ${Math.floor(timeoutMs / 1000)}s`,
        },
        timedOut: true,
      });
    }, timeoutMs);
    timer.unref?.();
  });
  return Promise.race([work.then((result) => ({ result, timedOut: false })), timeout]).finally(
    () => {
      if (timer) {
        clearTimeout(timer);
      }
    },
  );
}

function extractCompactInstructions(params: {
  rawBody?: string;
  ctx: import("../templating.js").MsgContext;
  cfg: OpenClawConfig;
  agentId?: string;
  isGroup: boolean;
}): string | undefined {
  const raw = stripStructuralPrefixes(params.rawBody ?? "");
  const stripped = params.isGroup
    ? stripMentions(raw, params.ctx, params.cfg, params.agentId)
    : raw;
  const trimmed = stripped.trim();
  if (!trimmed) {
    return undefined;
  }
  const lowered = trimmed.toLowerCase();
  const prefix = lowered.startsWith("/compact") ? "/compact" : null;
  if (!prefix) {
    return undefined;
  }
  let rest = trimmed.slice(prefix.length).trimStart();
  if (rest.startsWith(":")) {
    rest = rest.slice(1).trimStart();
  }
  return rest.length ? rest : undefined;
}

export const handleCompactCommand: CommandHandler = async (params) => {
  const compactRequested =
    params.command.commandBodyNormalized === "/compact" ||
    params.command.commandBodyNormalized.startsWith("/compact ");
  if (!compactRequested) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /compact from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!params.sessionEntry?.sessionId) {
    return {
      shouldContinue: false,
      reply: { text: "⚙️ Compaction unavailable (missing session id)." },
    };
  }
  const sessionId = params.sessionEntry.sessionId;
  if (isEmbeddedPiRunActive(sessionId)) {
    abortEmbeddedPiRun(sessionId);
    await waitForEmbeddedPiRunEnd(sessionId, 15_000);
  }
  const customInstructions = extractCompactInstructions({
    rawBody: params.ctx.CommandBody ?? params.ctx.RawBody ?? params.ctx.Body,
    ctx: params.ctx,
    cfg: params.cfg,
    agentId: params.agentId,
    isGroup: params.isGroup,
  });

  const sessionFile = resolveSessionFilePath(
    sessionId,
    params.sessionEntry,
    resolveSessionFilePathOptions({
      agentId: params.agentId,
      storePath: params.storePath,
    }),
  );
  await cleanStaleLockFiles({
    sessionsDir: path.dirname(sessionFile),
    staleMs: MANUAL_COMPACTION_LOCK_STALE_MS,
    removeStale: true,
  });

  const compactionRunId = `compact:${sessionId}`;
  emitAgentEvent({
    runId: compactionRunId,
    stream: "compaction",
    sessionKey: params.sessionKey,
    data: { phase: "start", trigger: "manual" },
  });

  const manualCompactionTimeoutMs = resolveManualCompactionTimeoutMs(params.cfg);
  const resolvedCompactionModel = resolveManualCompactionModel({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
  });

  const compactionPromise = compactEmbeddedPiSession({
    sessionId,
    sessionKey: params.sessionKey,
    messageChannel: params.command.channel,
    groupId: params.sessionEntry.groupId,
    groupChannel: params.sessionEntry.groupChannel,
    groupSpace: params.sessionEntry.space,
    spawnedBy: params.sessionEntry.spawnedBy,
    sessionFile,
    workspaceDir: params.workspaceDir,
    agentDir: params.agentDir,
    config: params.cfg,
    skillsSnapshot: params.sessionEntry.skillsSnapshot,
    provider: resolvedCompactionModel.provider,
    model: resolvedCompactionModel.model,
    thinkLevel: params.resolvedThinkLevel ?? (await params.resolveDefaultThinkingLevel()),
    bashElevated: {
      enabled: false,
      allowed: false,
      defaultLevel: "off",
    },
    customInstructions,
    trigger: "manual",
    senderIsOwner: params.command.senderIsOwner,
    ownerNumbers: params.command.ownerList.length > 0 ? params.command.ownerList : undefined,
  });

  let outcome: ManualCompactionOutcome;
  try {
    outcome = await withManualCompactionTimeout(compactionPromise, manualCompactionTimeoutMs);
  } catch (err) {
    outcome = {
      timedOut: false,
      result: {
        ok: false,
        compacted: false,
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const { result, timedOut } = outcome;
  if (timedOut) {
    abortEmbeddedPiRun(sessionId);
    await waitForEmbeddedPiRunEnd(sessionId, MANUAL_COMPACTION_ABORT_GRACE_MS);
  }

  emitAgentEvent({
    runId: compactionRunId,
    stream: "compaction",
    sessionKey: params.sessionKey,
    data: {
      phase: "end",
      trigger: "manual",
      ok: result.ok,
      compacted: result.compacted,
      timedOut,
    },
  });

  const compactLabel = result.ok
    ? result.compacted
      ? result.result?.tokensBefore != null && result.result?.tokensAfter != null
        ? `Compacted (${formatTokenCount(result.result.tokensBefore)} → ${formatTokenCount(result.result.tokensAfter)})`
        : result.result?.tokensBefore
          ? `Compacted (${formatTokenCount(result.result.tokensBefore)} before)`
          : "Compacted"
      : "Compaction skipped"
    : "Compaction failed";
  if (result.ok && result.compacted) {
    await incrementCompactionCount({
      sessionEntry: params.sessionEntry,
      sessionStore: params.sessionStore,
      sessionKey: params.sessionKey,
      storePath: params.storePath,
      // Update token counts after compaction
      tokensAfter: result.result?.tokensAfter,
    });
  }
  // Use the post-compaction token count for context summary if available
  const tokensAfterCompaction = result.result?.tokensAfter;
  const totalTokens = tokensAfterCompaction ?? resolveFreshSessionTotalTokens(params.sessionEntry);
  const contextSummary = formatContextUsageShort(
    typeof totalTokens === "number" && totalTokens > 0 ? totalTokens : null,
    params.contextTokens ?? params.sessionEntry.contextTokens ?? null,
  );
  const reason = result.reason?.trim();
  const line = reason
    ? `${compactLabel}: ${reason} • ${contextSummary}`
    : `${compactLabel} • ${contextSummary}`;
  enqueueSystemEvent(line, { sessionKey: params.sessionKey });
  return { shouldContinue: false, reply: { text: `⚙️ ${line}` } };
};
