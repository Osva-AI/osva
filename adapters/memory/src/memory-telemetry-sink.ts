import type { TelemetryEvent, TelemetrySink } from "@osva/contracts";

import { freezeClone } from "./clone.js";

/**
 * In-memory TelemetrySink for tests. It is not canonical Run storage.
 */
export class MemoryTelemetrySink implements TelemetrySink {
  private readonly events: TelemetryEvent[] = [];

  async emit(event: TelemetryEvent): Promise<void> {
    this.events.push(freezeClone(event));
  }

  /**
   * Read-only cloned snapshot of recorded events, in insertion order.
   */
  snapshot(): readonly TelemetryEvent[] {
    return Object.freeze(this.events.map((event) => freezeClone(event)));
  }
}
