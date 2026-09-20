import { KnowledgeUnsupportedMediaTypeError } from "@osva/domain";
import type { KnowledgeParser, KnowledgeParserRegistry } from "@osva/domain";

import { MarkdownKnowledgeParser } from "./markdown-parser.js";
import { PdfKnowledgeParser } from "./pdf-parser.js";
import { PlainTextKnowledgeParser } from "./text-parser.js";

export class OsvaKnowledgeParserRegistry implements KnowledgeParserRegistry {
  private readonly parsers: readonly KnowledgeParser[];

  constructor(
    parsers: readonly KnowledgeParser[] = [
      new PlainTextKnowledgeParser(),
      new MarkdownKnowledgeParser(),
      new PdfKnowledgeParser(),
    ],
  ) {
    this.parsers = parsers;
  }

  resolve(mediaType: string): KnowledgeParser {
    const parser = this.parsers.find((candidate) =>
      candidate.supports(mediaType),
    );
    if (parser === undefined) {
      throw new KnowledgeUnsupportedMediaTypeError(mediaType);
    }
    return parser;
  }
}
