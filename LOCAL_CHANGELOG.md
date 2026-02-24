# LOCAL_CHANGELOG.md — Local Merge Keepers (OpenClaw)

> Purpose: tell future coding/merge agents what local behavior changes must be preserved when syncing with upstream.
> Scope: only local-only commits and local runtime semantics that can silently regress.

## Quick Status

Local-only **behavior** commits on top of `origin/main` (current snapshot):

- `c0318bf83` — reply: restore session-scoped bootstrap and queue state wiring
- `f9a231081` — agents: pass config into embedded system prompt builder
- `c7c8676a3` — agents: bind message channel prompt options to agent channels
- `44d1a1a5c` — agents: filter plugin skills by agent channel bindings
- `8f340ce42` — plugins: gate channel plugin tools by bindings
- `f52c02533` — agents: filter channel tools by agent bindings
- `5f693c94b` — routing: expose agent bound channels for filtering
- `a326945ee` — fix: apply compaction timeout/model overrides to embedded compaction
- `2c7d21109` — fix: apply compaction timeout/model overrides to /compact
- `0f6742321` — fix: restore compaction config keys
- `061e2c160` — outbound: harden local attachment reads for message actions
- `2cdc35c26` — heartbeat: allow targeted wake for non-heartbeat agents
- `ab33ee7f8` — reply: unify /insert as boundary-first injection and fix outbound mediaLocalRoots typing
- `170562066` — reply: make /insert guaranteed boundary-first injection with interrupt fallback

Check with:

```bash
git log --oneline origin/main..HEAD
```

---

## MUST KEEP #1 — `/insert` semantics changed (boundary-first + interrupt fallback)

### Why it matters

Local workflows (especially OpenCode callback correction/reminders) rely on `/insert` being stronger than “just next turn priority”.

### Local behavior (required)

`/insert` should mean:

1. **Try current-run boundary injection first** (streaming/tool boundary)
2. If boundary not available soon, **auto-upgrade to interrupt + insert**
3. Guarantee insertion intent is not silently dropped

### Key code locations

- `src/auto-reply/reply/commands-insert.ts`
  - `handleInsertCommand()` (authorization + command rewrite + insert flags)
- `src/auto-reply/reply/get-reply-run.ts`
  - `runPreparedReply()` (`insertBoundaryOnly` should not degrade into normal followup semantics)
- `src/auto-reply/reply/agent-runner.ts`
  - `runReplyAgent()` `insertBoundaryOnly` branch (boundary wait + abort fallback)
- `src/auto-reply/reply/queue/enqueue.ts`
  - `queueKind === "insert"` / `insertNext`

### Merge risk (what upstream may revert)

- `/insert` treated as normal followup queue (next-turn only)
- loss of abort fallback path
- removal of `insertBoundaryOnly` handling

### Regression checks (minimum)

1. `/insert` parses and rewrites prompt correctly
2. while active run is streaming, `/insert` can be injected (or at least attempted)
3. if not injectable in boundary window, run aborts and insert still executes
4. unauthorized sender cannot use `/insert`

---

## MUST KEEP #2 — Hook wake/session routing (`/hooks/wake` targeted session + `/hooks/agent` sessionKey)

### Why it matters

OpenCode bridge sends callbacks (done/error/question/permission) to a **specific OpenClaw session**, not just the main/default session.
Both `/hooks/wake` and `/hooks/agent` routing behavior must remain predictable.

### Local behavior (required)

1. `POST /hooks/wake` payload may contain `session` or `sessionKey`, and OpenClaw should enqueue the system event to that sessionKey and trigger targeted wake.
2. `POST /hooks/agent` may carry `sessionKey`, and isolated agent turn + wake should run against that session.
3. `/hooks/wake` without explicit session should continue to default to the main session.

### Key code locations

- `src/gateway/hooks.ts`
  - `normalizeWakePayload()` returns `{ text, mode, sessionKey? }` (`session` alias accepted)
- `src/gateway/server/hooks.ts`
  - `dispatchWakeHook()` uses provided `sessionKey` when present, else main session
  - `enqueueSystemEvent(text, { sessionKey })`
  - `requestHeartbeatNow({ reason: "hook:wake", sessionKey })`
  - `dispatchAgentHook()` uses request/mapping `sessionKey` for isolated runs
- `src/gateway/server-http.ts`
  - `/hooks/wake` + `/hooks/agent` dispatch wiring

### Merge risk

- upstream merge may drop `session`/`sessionKey` extraction from `/hooks/wake`
- `/hooks/wake` may enqueue to main but trigger non-targeted wake (sessionKey lost in wake request)
- `/hooks/agent` `sessionKey` handling regresses to main/default routing

### Regression checks

5. `/hooks/wake` with `session` or `sessionKey` returns 200 and targets the requested session queue
6. callback routed to session A does not appear in session B

---

## MUST KEEP #3 — Targeted wake must work even if agent has no periodic heartbeat config

### Why it matters

Without this patch, callbacks can enqueue events but never execute unless the target agent is also registered as a heartbeat agent. This creates the false behavior of “must wait for a user message”.

### Local behavior (required)

Targeted wake (`reason=hook|wake` with `sessionKey`/`agentId`) must execute even when:

- agent has no heartbeat interval
- agent is not in `state.agents` periodic heartbeat list

### Key code locations

- `src/infra/heartbeat-runner.ts`
  - `startHeartbeatRunner()` targeted branch should run before periodic heartbeat gating
  - targeted branch should call `runOnce(... allowDisabledForWake: true)` even if `state.agents.get(targetAgentId)` is missing
- `src/infra/heartbeat-runner.ts`
  - `runHeartbeatOnce()` supports `allowDisabledForWake`
  - queue gate bypass allowed for `hook/wake` targeted events (`shouldBypassQueueGateForWake`)
- `src/infra/heartbeat-runner.scheduler.test.ts`
  - targeted wake tests (including no periodic heartbeat agents registered)

### Merge risk

- targeted wake re-coupled to periodic heartbeat registration
- callbacks look accepted (200 OK) but do nothing until next user message

### Regression checks

7. targeted wake to agent without heartbeat config still triggers `runOnce`
8. sleep/busy-session callback path can continue without requiring a new user message after reload

---

## MUST KEEP #4 — Agent-channel bindings gate tools/skills/system-prompt channel options

### Why it matters

Without channel-aware filtering, an agent can leak capabilities from channels it is not bound to.
This breaks routing isolation and can produce incorrect tool surfaces.

### Local behavior (required)

1. Resolve bound channels via routing bindings.
2. Filter channel tools and channel plugin tools by agent bound channels.
3. Filter plugin skills by agent bound channels.
4. System prompt channel options for embedded/reply paths stay aligned with bound channels.

### Key code locations

- `src/routing/bindings.ts`
  - `getAgentBoundChannels()`
- `src/agents/channel-tools.ts`
- `src/plugins/tools.ts`
- `src/agents/skills/plugin-skills.ts`
- `src/agents/system-prompt.ts`
- `src/auto-reply/reply/commands-system-prompt.ts`

### Merge risk

- bound-channel checks dropped from one surface (tools/skills/prompt) causing partial leakage
- fallback behavior accidentally exposes all channels

### Regression checks

9. agent bound to channel A cannot use channel-B-only tools
10. plugin skills list remains filtered by bound channels
11. embedded/reply system prompt channel options match bindings

---

## MUST KEEP #5 — Compaction override keys + timeout/model application (CLI + embedded)

### Why it matters

Compaction reliability depends on honoring configured timeout/model overrides across both `/compact` and embedded compaction paths.

### Local behavior (required)

1. Config keys for compaction overrides remain present in types + schema.
2. `/compact` command path applies compaction timeout/model overrides.
3. Embedded compaction path applies the same overrides.

### Key code locations

- `src/config/types.agent-defaults.ts`
- `src/config/zod-schema.agent-defaults.ts`
- `src/auto-reply/reply/commands-compact.ts`
- `src/agents/pi-embedded-runner/compact.ts`
- `src/agents/pi-embedded-runner/compaction-safety-timeout.ts`

### Merge risk

- override keys removed/renamed in config schema
- only one compaction path honors overrides, causing inconsistent behavior

### Regression checks

12. configured compaction timeout/model is honored in `/compact`
13. configured compaction timeout/model is honored in embedded compaction

---

## MUST KEEP #6 — Local attachment reads must respect outbound roots policy

### Why it matters

Outbound local-file sending must not bypass path policy. Reads must stay constrained by configured/derived roots.

### Local behavior (required)

1. Message-action local attachment reads are policy-checked before reading files.
2. Outbound plugins receive/propagate media roots constraints correctly.
3. Error messaging for blocked local paths remains actionable.

### Key code locations

- `src/infra/outbound/message-action-params.ts`
- `src/infra/outbound/message-action-runner.ts`
- `src/web/media.ts`
- `src/channels/plugins/outbound/{telegram,whatsapp,slack,discord,imessage}.ts`

### Merge risk

- direct file reads reintroduced without roots checks
- plugin adapters drop roots metadata and silently allow broader reads

### Regression checks

14. allowed local file path succeeds when under roots
15. disallowed local file path is rejected with clear policy error

---

## IMPORTANT LOCAL NOTE — OpenCode bridge expectation

OpenCode callback bridge (`oh-my-opencode`) currently depends on:

- `/insert <text>` boundary-first semantics
- `/hooks/agent` with `sessionKey` for targeted callback runs
- `/hooks/wake` targeted session wake support (`session` / `sessionKey`)

If merge changes `/insert`, hooks routing, or targeted wake behavior, OpenCode integration may appear flaky even when callback files/notifications are generated correctly.

---

## CAN ALIGN UPSTREAM (optional / lower risk)

These can be re-evaluated during merge if upstream has better equivalents:

- exact wording of wake-event prompt text
- local docs organization (`architecture/...` vs root changelog docs)
- additional local adapter typing niceties if upstream already solved them

But do **not** drop the three MUST KEEP behaviors above without explicit review.

---

## Merge Checklist (5-minute version)

Before merge/rebase:

- [ ] `git log origin/main..HEAD --oneline`
- [ ] inspect diffs for files in MUST KEEP sections
- [ ] note any upstream edits touching `/insert`, hooks, heartbeat runner
- [ ] note any upstream edits touching bindings/tools/skills filtering
- [ ] note any upstream edits touching compaction config keys and override paths
- [ ] note any upstream edits touching outbound local attachment reads

After merge/rebase:

- [ ] run keeper checks (1-15 above)
- [ ] run `pnpm -s exec tsc -p tsconfig.json --noEmit`
- [ ] run `/hooks/agent` targeted `sessionKey` smoke test
- [ ] run `/hooks/wake` targeted session smoke test (`session` and/or `sessionKey`)
- [ ] run one OpenCode callback end-to-end smoke test
