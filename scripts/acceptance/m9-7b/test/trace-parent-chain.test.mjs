import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TRACE_SPAN_CHAIN,
  validateTraceParentChain,
} from "../lib/b4-otlp-capture.js";

describe("OTLP trace parent chain validation", () => {
  it("accepts a direct five-span execution chain", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "abc",
                  spanId: "01",
                  name: TRACE_SPAN_CHAIN[0],
                },
                {
                  traceId: "abc",
                  spanId: "02",
                  parentSpanId: "01",
                  name: TRACE_SPAN_CHAIN[1],
                },
                {
                  traceId: "abc",
                  spanId: "03",
                  parentSpanId: "02",
                  name: TRACE_SPAN_CHAIN[2],
                },
                {
                  traceId: "abc",
                  spanId: "04",
                  parentSpanId: "03",
                  name: TRACE_SPAN_CHAIN[3],
                },
                {
                  traceId: "abc",
                  spanId: "05",
                  parentSpanId: "04",
                  name: TRACE_SPAN_CHAIN[4],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = validateTraceParentChain([
      Buffer.from(JSON.stringify(payload)),
    ]);
    assert.equal(result.parentChainValid, true);
    assert.equal(result.matchedChain?.traceId, "abc");
  });

  it("rejects spans that share names but skip parent links", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: TRACE_SPAN_CHAIN.map((name, index) => ({
                traceId: "abc",
                spanId: String(index + 1).padStart(2, "0"),
                name,
              })),
            },
          ],
        },
      ],
    };
    const result = validateTraceParentChain([
      Buffer.from(JSON.stringify(payload)),
    ]);
    assert.equal(result.parentChainValid, false);
  });
});
