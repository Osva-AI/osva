import { Readable } from "node:stream";

interface RuntimeArtifactView {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly digest: string;
}

export async function run(context: {
  readonly input: unknown;
  readonly artifacts?: {
    readonly create: (
      name: string,
      content: Readable,
      options?: { readonly mediaType?: string },
    ) => Promise<RuntimeArtifactView>;
    readonly get: (artifactId: string) => Promise<RuntimeArtifactView>;
    readonly open: (artifactId: string) => Promise<{
      readonly artifact: RuntimeArtifactView;
      readonly stream: Readable;
    }>;
  };
}): Promise<{
  readonly artifactId: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly digest: string;
  readonly roundTrip: string;
  readonly fetchedName: string;
}> {
  const input = context.input as { content?: string };
  const payload = input.content ?? "artifact-e2e";

  if (context.artifacts === undefined) {
    throw new Error("Artifact capability is unavailable.");
  }

  const created = await context.artifacts.create(
    "runtime-artifact.txt",
    Readable.from([payload]),
    { mediaType: "text/plain" },
  );

  const opened = await context.artifacts.open(created.id);
  const chunks: string[] = [];
  for await (const chunk of opened.stream) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk),
    );
  }

  const metadata = await context.artifacts.get(created.id);

  return {
    artifactId: created.id,
    name: created.name,
    sizeBytes: created.sizeBytes,
    digest: created.digest,
    roundTrip: chunks.join(""),
    fetchedName: metadata.name,
  };
}
