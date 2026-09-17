import { describe, expect, it } from "vitest";

import {
  evaluateRemoteHttpDestination,
  isNonPublicAddress,
  resolveRemoteHttpConnectionTarget,
} from "../src/outbound-network.js";

describe("isNonPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.255",
    "0.0.0.0",
    "10.1.2.3",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.1",
    "192.168.1.10",
    "169.254.169.254",
    "169.254.0.1",
    "100.64.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "ff02::1",
    "fc00::1",
    "fd12:3456:789a::1",
    "fec0::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
  ])("treats %s as non-public", (address) => {
    expect(isNonPublicAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2001:4860:4860::8888"])(
    "treats %s as public",
    (address) => {
      expect(isNonPublicAddress(address)).toBe(false);
    },
  );
});

describe("evaluateRemoteHttpDestination", () => {
  it.each([
    "http://127.0.0.1/execute",
    "http://127.0.0.1:9/execute",
    "http://[::1]/execute",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.8/execute",
    "http://172.16.4.1/execute",
    "http://172.31.0.1/execute",
    "http://192.168.0.5/execute",
    "http://localhost/execute",
    "http://LOCALHOST./execute",
  ])("rejects %s by default without DNS lookup", async (endpoint) => {
    await expect(
      evaluateRemoteHttpDestination(endpoint, {
        allowPrivateNetworks: false,
        lookup: async () => {
          throw new Error("lookup must not run for literal forbidden hosts");
        },
      }),
    ).resolves.toBe("forbidden_destination");
  });

  it("rejects a hostname that resolves to a forbidden address", async () => {
    await expect(
      evaluateRemoteHttpDestination("https://evil.example/execute", {
        allowPrivateNetworks: false,
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    ).resolves.toBe("forbidden_destination");
  });

  it("rejects a hostname if any resolved address is private", async () => {
    await expect(
      evaluateRemoteHttpDestination("https://mixed.example/execute", {
        allowPrivateNetworks: false,
        lookup: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ],
      }),
    ).resolves.toBe("forbidden_destination");
  });

  it("allows a public hostname with stubbed public DNS", async () => {
    await expect(
      evaluateRemoteHttpDestination("https://runtime.example.com/execute", {
        allowPrivateNetworks: false,
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).resolves.toBe("allowed");
  });

  it("returns a pinned address for an allowed hostname", async () => {
    await expect(
      resolveRemoteHttpConnectionTarget("https://runtime.example.com/execute", {
        allowPrivateNetworks: false,
        lookup: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "93.184.216.35", family: 4 },
        ],
      }),
    ).resolves.toMatchObject({
      kind: "allowed",
      hostname: "runtime.example.com",
      pinnedAddress: { address: "93.184.216.34", family: 4 },
    });
  });

  it("allows private destinations only when the operator opts in", async () => {
    await expect(
      evaluateRemoteHttpDestination("http://127.0.0.1:9/execute", {
        allowPrivateNetworks: false,
      }),
    ).resolves.toBe("forbidden_destination");

    await expect(
      evaluateRemoteHttpDestination("http://127.0.0.1:9/execute", {
        allowPrivateNetworks: true,
      }),
    ).resolves.toBe("allowed");

    await expect(
      evaluateRemoteHttpDestination("http://10.1.2.3/execute", {
        allowPrivateNetworks: true,
        lookup: async () => {
          throw new Error(
            "lookup is unnecessary when private networks are allowed",
          );
        },
      }),
    ).resolves.toBe("allowed");
  });
});
