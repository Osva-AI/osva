import { text } from "node:stream/consumers";

import type { KnowledgeTextSegmentV1 } from "@osva/contracts";
import type { KnowledgeParser, KnowledgeParserParseInput } from "@osva/domain";

export class PlainTextKnowledgeParser implements KnowledgeParser {
  supports(mediaType: string): boolean {
    return mediaType === "text/plain";
  }

  async *parse(
    input: KnowledgeParserParseInput,
  ): AsyncIterable<KnowledgeTextSegmentV1> {
    const raw = await text(input.content);
    const normalized = raw.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    let ordinal = 1;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      yield {
        ordinal,
        text: trimmed,
        location: { sourceSegmentOrdinal: ordinal },
      };
      ordinal += 1;
    }
  }
}
