import { afterEach, beforeEach, vi } from "vitest";
import * as ssrf from "../../infra/net/ssrf.js";

export function installWebFetchSsrfHarness() {
  const priorFetch = global.fetch;

  beforeEach(() => {
    const addresses = ["93.184.216.34"];
    const lookupFn = (async () =>
      addresses.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }))) as unknown as ssrf.LookupFn;
    const resolvePinnedHostname = ssrf.resolvePinnedHostname;
    const resolvePinnedHostnameWithPolicy = ssrf.resolvePinnedHostnameWithPolicy;
    vi.spyOn(ssrf, "resolvePinnedHostname").mockImplementation(
      async (hostname) => await resolvePinnedHostname(hostname, lookupFn),
    );
    vi.spyOn(ssrf, "resolvePinnedHostnameWithPolicy").mockImplementation(
      async (hostname, params) =>
        await resolvePinnedHostnameWithPolicy(hostname, {
          ...params,
          lookupFn,
        }),
    );
  });

  afterEach(() => {
    global.fetch = priorFetch;
    vi.restoreAllMocks();
  });
}

export function createBaseWebFetchToolConfig(opts?: { maxResponseBytes?: number }): {
  config: {
    tools: {
      web: {
        fetch: {
          cacheTtlMinutes: number;
          firecrawl: { enabled: boolean };
          maxResponseBytes?: number;
        };
      };
    };
  };
} {
  return {
    config: {
      tools: {
        web: {
          fetch: {
            cacheTtlMinutes: 0,
            firecrawl: { enabled: false },
            ...(opts?.maxResponseBytes ? { maxResponseBytes: opts.maxResponseBytes } : {}),
          },
        },
      },
    },
  };
}
