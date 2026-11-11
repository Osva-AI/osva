import { describe, expect, it } from "vitest";

import {
  isComposeHostPortConflictOutput,
  parseHostPortsFromComposeConflictOutput,
} from "../src/setup/compose-host-port-conflict.js";

describe("compose host port conflict detection", () => {
  it("recognizes common Docker bind failures", () => {
    expect(
      isComposeHostPortConflictOutput(
        "Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint ... Bind for 127.0.0.1:8080 failed: port is already allocated",
      ),
    ).toBe(true);
    expect(
      isComposeHostPortConflictOutput(
        "listen tcp 127.0.0.1:4174: bind: address already in use",
      ),
    ).toBe(true);
    expect(
      isComposeHostPortConflictOutput("unknown compose configuration error"),
    ).toBe(false);
  });

  it("extracts loopback ports from compose output", () => {
    const ports = parseHostPortsFromComposeConflictOutput(
      "Bind for 127.0.0.1:8080 failed: port is already allocated (Host:0.0.0.0:3100)",
    );
    expect(ports).toEqual([8080, 3100]);
  });
});
