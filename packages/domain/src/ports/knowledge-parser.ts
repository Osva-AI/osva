import type {
  ArtifactBlobContentStream,
  KnowledgeTextSegmentV1,
} from "@osva-ai/contracts";

export interface KnowledgeParserParseInput {
  readonly content: ArtifactBlobContentStream;
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
