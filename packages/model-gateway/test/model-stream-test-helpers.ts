import type { ModelStreamEvent } from "@osva-ai/contracts";
import { assembleModelStreamCompletion } from "@osva-ai/contracts";
import { modelStreamEventSchema } from "@osva-ai/contracts/schemas";

export async function collectModelStreamEvents(
  source: AsyncIterable<ModelStreamEvent>,
): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of source) {
    expectSchemaValid(event);
    events.push(event);
  }
  return events;
}

function expectSchemaValid(event: ModelStreamEvent): void {
  const parsed = modelStreamEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
}

export async function assembleStream(source: AsyncIterable<ModelStreamEvent>) {
  const events = await collectModelStreamEvents(source);
  return assembleModelStreamCompletion(events);
}
