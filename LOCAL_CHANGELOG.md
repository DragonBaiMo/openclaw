# LOCAL_CHANGELOG.md — Local Merge Keepers (OpenClaw)

> Purpose: tell future coding/merge agents what local behavior changes must be preserved when syncing with upstream.
> Scope: only local-only commits and local runtime semantics that can silently regress.

## Quick Status

Local-only commits on top of `origin/main` (current snapshot):

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

## MUST KEEP #2 — `/hooks/wake` supports targeted session (`payload.session`)

### Why it matters

OpenCode bridge sends callbacks (done/error/question/permission) to a **specific OpenClaw session**, not just the main/default session.

### Local behavior (required)

`POST /hooks/wake` payload may contain `session`, and OpenClaw should enqueue the system event to that sessionKey and trigger targeted wake.

### Key code locations

- `src/gateway/hooks.ts`
  - `normalizeWakePayload()` returns `{ text, mode, session? }`
- `src/gateway/server/hooks.ts`
  - `dispatchWakeHook()` uses `payload.session` as `sessionKey`
  - `enqueueSystemEvent(text, { sessionKey })`
  - `requestHeartbeatNow({ reason: "hook:wake", sessionKey })`
- `src/gateway/server-http.ts`
  - `/hooks/wake` path dispatch wiring

### Merge risk

- upstream merge may drop `session` field from wake payload handling
- wake events all go back to default/main session again (wrong routing)

### Regression checks

5. `/hooks/wake` with `session` returns 200 and targets the requested session queue
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
8. sleep/busy-session callback test: OpenCode callback can interrupt/insert without user sending a new message (after process reload)

---

## IMPORTANT LOCAL NOTE — OpenCode bridge expectation

OpenCode callback bridge (`oh-my-opencode`) currently sends reminders via:

- `/hooks/wake` + `/insert <text>` semantics
- `targetSession` (sessionKey) is the routing key

If merge changes `/insert`, hooks wake, or targeted wake behavior, OpenCode integration may appear flaky even when callback files/notifications are generated correctly.

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

After merge/rebase:

- [ ] run keeper tests (1-8 above)
- [ ] run `pnpm -s exec tsc -p tsconfig.json --noEmit`
- [ ] run `/hooks/wake` targeted session smoke test
- [ ] run one OpenCode callback end-to-end smoke test
