import type { Readable } from "node:stream";

import type { KnowledgeTextSegmentV1 } from "@osva/contracts";
import type { KnowledgeParser, KnowledgeParserParseInput } from "@osva/domain";
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";

(GlobalWorkerOptions as { disableWorker?: boolean }).disableWorker = true;

export class PdfKnowledgeParser implements KnowledgeParser {
  supports(mediaType: string): boolean {
    return mediaType === "application/pdf";
  }

  async *parse(
    input: KnowledgeParserParseInput,
  ): AsyncIterable<KnowledgeTextSegmentV1> {
    const buffer = await readStreamBuffer(input.content);
    const data = new Uint8Array(buffer);
    const document = await getDocument({
      data,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      useSystemFonts: true,
    }).promise;

    let ordinal = 1;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? String(item.str) : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText.length === 0) {
        continue;
      }
      yield {
        ordinal,
        text: pageText,
        location: { page: pageNumber, sourceSegmentOrdinal: ordinal },
      };
      ordinal += 1;
    }
  }
}

async function readStreamBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
