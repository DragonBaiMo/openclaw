import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATEWAY_EVENT_UPDATE_AVAILABLE } from "../../../src/gateway/events.js";
import { connectGateway } from "./app-gateway.ts";
import type {
  GatewayBrowserClient,
  GatewayBrowserClientOptions,
  GatewayEventFrame,
} from "./gateway.ts";

type TestClient = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  emitGap: (expected: number, received: number) => void;
  emitEvent: (evt: GatewayEventFrame) => void;
  emitClose: (code: number, reason?: string) => void;
  emitHello: (hello?: { snapshot?: unknown }) => void;
};

function createHost() {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    password: "",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    chatRunId: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    updateAvailable: null,
    chatStream: null,
    chatStreamStartedAt: null,
    updateComplete: Promise.resolve(),
    querySelector: () => null,
    style: document.createElement("div").style,
    chatScrollFrame: null,
    chatScrollTimeout: null,
    chatHasAutoScrolled: false,
    chatUserNearBottom: true,
    chatNewMessagesBelow: false,
    logsScrollFrame: null,
    logsAtBottom: true,
    topbarObserver: null,
    chatInsertNext: null,
    chatSkipNextQueueDrain: false,
    chatActivityLeaseUntil: null,
  };
}

type MutableHost = Omit<
  ReturnType<typeof createHost>,
  "chatRunId" | "chatStream" | "chatStreamStartedAt" | "chatInsertNext" | "chatSkipNextQueueDrain"
> & {
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatInsertNext: {
    id: string;
    text: string;
    createdAt: number;
    kind: "insert";
  } | null;
  chatSkipNextQueueDrain: boolean;
};

function createClientFactory(list: TestClient[]) {
  return (opts: GatewayBrowserClientOptions): GatewayBrowserClient => {
    const client: TestClient = {
      start: vi.fn(),
      stop: vi.fn(),
      request: vi.fn().mockResolvedValue({}),
      emitGap: (expected, received) => opts.onGap?.({ expected, received }),
      emitEvent: (evt) => opts.onEvent?.(evt),
      emitClose: (code, reason) => opts.onClose?.({ code, reason: reason ?? "" }),
      emitHello: (hello) =>
        opts.onHello?.(
          (hello ?? { snapshot: {} }) as unknown as Parameters<
            NonNullable<GatewayBrowserClientOptions["onHello"]>
          >[0],
        ),
    };
    list.push(client);
    return client as unknown as GatewayBrowserClient;
  };
}

describe("connectGateway", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();
    const clients: TestClient[] = [];
    const createClient = createClientFactory(clients);

    connectGateway(host as never, { createClient });
    expect(clients[0]).toBeDefined();

    connectGateway(host as never, { createClient });
    expect(clients[1]).toBeDefined();

    clients[0].emitGap(10, 13);
    expect(host.lastError).toBeNull();

    clients[1].emitGap(20, 24);
    expect(host.lastError).toBe(
      "event gap detected (expected seq 20, got 24); refresh recommended",
    );
  });

  it("ignores stale client events and only applies active update.available", () => {
    const host = createHost();
    const clients: TestClient[] = [];
    const createClient = createClientFactory(clients);

    connectGateway(host as never, { createClient });
    connectGateway(host as never, { createClient });

    clients[0].emitEvent({
      type: "event",
      event: "presence",
      payload: { presence: [{ host: "stale" }] },
    });
    expect(host.eventLogBuffer).toHaveLength(0);

    clients[1].emitEvent({
      type: "event",
      event: "presence",
      payload: { presence: [{ host: "active" }] },
    });
    expect(host.eventLogBuffer).toHaveLength(1);

    clients[0].emitEvent({
      type: "event",
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "9.9.9", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toBeNull();

    clients[1].emitEvent({
      type: "event",
      event: GATEWAY_EVENT_UPDATE_AVAILABLE,
      payload: {
        updateAvailable: { currentVersion: "1.0.0", latestVersion: "2.0.0", channel: "latest" },
      },
    });
    expect(host.updateAvailable).toEqual({
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      channel: "latest",
    });
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();
    const clients: TestClient[] = [];
    const createClient = createClientFactory(clients);

    connectGateway(host as never, { createClient });
    connectGateway(host as never, { createClient });

    clients[0].emitClose(1005);
    expect(host.lastError).toBeNull();

    clients[1].emitClose(1005);
    expect(host.lastError).toBe("disconnected (1005): no reason");
  });

  it("clears preserved run only when active epoch timer fires", async () => {
    vi.useFakeTimers();
    try {
      const host = createHost() as MutableHost;
      const clients: TestClient[] = [];
      const createClient = createClientFactory(clients);

      host.chatRunId = "run-1";
      host.chatStream = "partial";
      host.chatStreamStartedAt = 1;

      connectGateway(host as never, { createClient });
      clients[0].emitHello();

      host.chatRunId = "run-1";
      host.chatStream = "partial";
      host.chatStreamStartedAt = 2;
      connectGateway(host as never, { createClient });
      clients[1].emitHello();

      await vi.advanceTimersByTimeAsync(7_999);
      expect(host.chatRunId).toBe("run-1");

      await vi.advanceTimersByTimeAsync(1);
      expect(host.chatRunId).toBe(null);
      expect(host.chatStream).toBe(null);
      expect(host.chatStreamStartedAt).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes one-shot insert when reconnect cleanup expires", async () => {
    vi.useFakeTimers();
    try {
      const host = createHost() as MutableHost;
      const clients: TestClient[] = [];
      const createClient = createClientFactory(clients);

      host.chatRunId = "run-1";
      host.chatStream = "partial";
      host.chatStreamStartedAt = 1;
      host.chatInsertNext = {
        id: "ins-1",
        text: "urgent follow-up",
        createdAt: 1,
        kind: "insert",
      };

      connectGateway(host as never, { createClient });
      clients[0].emitHello();

      await vi.advanceTimersByTimeAsync(8_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(clients[0].request.mock.calls.length > 0).toBe(true);
      expect(host.chatInsertNext).toBeNull();
      expect(host.chatSkipNextQueueDrain).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
