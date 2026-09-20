import { text } from "node:stream/consumers";

import type { KnowledgeTextSegmentV1 } from "@osva/contracts";
import type { KnowledgeParser, KnowledgeParserParseInput } from "@osva/domain";

const MARKDOWN_MEDIA_TYPES = new Set([
  "text/markdown",
  "text/x-markdown",
  "application/markdown",
]);

export class MarkdownKnowledgeParser implements KnowledgeParser {
  supports(mediaType: string): boolean {
    return MARKDOWN_MEDIA_TYPES.has(mediaType);
  }

  async *parse(
    input: KnowledgeParserParseInput,
  ): AsyncIterable<KnowledgeTextSegmentV1> {
    const raw = await text(input.content);
    const normalized = raw.replace(/\r\n/g, "\n");
    const blocks = normalized.split(/\n{2,}/);
    let ordinal = 1;
    for (const block of blocks) {
      const stripped = stripMarkdown(block.trim());
      if (stripped.length === 0) {
        continue;
      }
      yield {
        ordinal,
        text: stripped,
        location: { sourceSegmentOrdinal: ordinal },
      };
      ordinal += 1;
    }
  }
}

function stripMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}
