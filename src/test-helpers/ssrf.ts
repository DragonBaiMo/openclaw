import { vi } from "vitest";
import * as ssrf from "../infra/net/ssrf.js";

export function mockPinnedHostnameResolution(addresses: string[] = ["93.184.216.34"]) {
  const buildPinned = (hostname: string) => {
    const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
    const pinnedAddresses = [...addresses];
    return {
      hostname: normalized,
      addresses: pinnedAddresses,
      lookup: ssrf.createPinnedLookup({ hostname: normalized, addresses: pinnedAddresses }),
    };
  };

  const primarySpy = vi
    .spyOn(ssrf, "resolvePinnedHostname")
    .mockImplementation(async (hostname) => buildPinned(hostname));

  vi.spyOn(ssrf, "resolvePinnedHostnameWithPolicy").mockImplementation(async (hostname, params) => {
    const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
    const policy = params?.policy;
    const allowPrivateNetwork =
      policy?.dangerouslyAllowPrivateNetwork === true || policy?.allowPrivateNetwork === true;
    if (!allowPrivateNetwork) {
      if (ssrf.isBlockedHostnameOrIp(normalized, policy)) {
        throw new ssrf.SsrFBlockedError(
          "Blocked hostname or private/internal/special-use IP address",
        );
      }
      for (const address of addresses) {
        if (ssrf.isBlockedHostnameOrIp(address, policy)) {
          throw new ssrf.SsrFBlockedError(
            "Blocked: resolves to private/internal/special-use IP address",
          );
        }
      }
    }
    return buildPinned(hostname);
  });

  return primarySpy;
}
