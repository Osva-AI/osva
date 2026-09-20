import type { Readable } from "node:stream";

import type { KnowledgeTextSegmentV1 } from "@osva/contracts";

export interface KnowledgeParserParseInput {
  readonly content: Readable;
  readonly mediaType: string;
}

export interface KnowledgeParser {
  supports(mediaType: string): boolean;
  parse(
    input: KnowledgeParserParseInput,
  ): AsyncIterable<KnowledgeTextSegmentV1>;
}

export interface KnowledgeParserRegistry {
  resolve(mediaType: string): KnowledgeParser;
}
