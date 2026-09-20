import type { KnowledgeTextSegmentV1 } from "@osva/contracts";
import { KNOWLEDGE_MAX_CHUNKS_PER_INDEX } from "@osva/contracts";

import { KnowledgeSourceTooLargeError } from "./errors.js";

export interface ChunkTextInput {
  readonly segments: readonly KnowledgeTextSegmentV1[];
  readonly chunkSize: number;
  readonly chunkOverlap: number;
}

export interface ChunkedText {
  readonly ordinal: number;
  readonly text: string;
  readonly location?: KnowledgeTextSegmentV1["location"];
}

export function chunkKnowledgeText(
  input: ChunkTextInput,
): readonly ChunkedText[] {
  const paragraphs: ChunkedText[] = [];
  let ordinal = 0;

  for (const segment of input.segments) {
    const normalized = segment.text.replace(/\r\n/g, "\n").trim();
    if (normalized.length === 0) {
      continue;
    }

    const parts = splitParagraphs(normalized);
    for (const part of parts) {
      paragraphs.push({
        ordinal: ordinal++,
        text: part,
        location: segment.location,
      });
    }
  }

  const chunks: ChunkedText[] = [];
  let buffer = "";
  let bufferLocation: ChunkedText["location"];

  const flush = (force: boolean): void => {
    const trimmed = buffer.trim();
    if (trimmed.length === 0) {
      buffer = "";
      bufferLocation = undefined;
      return;
    }

    if (!force && trimmed.length < input.chunkSize) {
      return;
    }

    chunks.push({
      ordinal: chunks.length,
      text: trimmed,
      location: bufferLocation,
    });

    if (chunks.length > KNOWLEDGE_MAX_CHUNKS_PER_INDEX) {
      throw new KnowledgeSourceTooLargeError(
        "Knowledge extraction exceeds maximum chunk count.",
      );
    }

    const overlapText = takeOverlapSuffix(trimmed, input.chunkOverlap);
    buffer = overlapText;
    bufferLocation = chunks[chunks.length - 1]?.location;
  };

  for (const paragraph of paragraphs) {
    const candidate =
      buffer.length === 0 ? paragraph.text : `${buffer}\n\n${paragraph.text}`;

    if (candidate.length <= input.chunkSize) {
      buffer = candidate;
      bufferLocation = bufferLocation ?? paragraph.location;
      continue;
    }

    if (buffer.length > 0) {
      flush(true);
    }

    if (paragraph.text.length <= input.chunkSize) {
      buffer = paragraph.text;
      bufferLocation = paragraph.location;
      continue;
    }

    let offset = 0;
    while (offset < paragraph.text.length) {
      const slice = paragraph.text.slice(offset, offset + input.chunkSize);
      buffer = slice;
      bufferLocation = paragraph.location;
      flush(true);
      offset += Math.max(1, input.chunkSize - input.chunkOverlap);
    }
    buffer = "";
    bufferLocation = undefined;
  }

  flush(true);
  return chunks;
}

function splitParagraphs(text: string): readonly string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function takeOverlapSuffix(text: string, overlap: number): string {
  if (overlap <= 0) {
    return "";
  }

  return text.slice(Math.max(0, text.length - overlap));
}
