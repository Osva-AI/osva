interface MemoryRecordView {
  readonly key: string;
  readonly value: unknown;
  readonly revision: number;
}

interface MemoryCapabilityErrorLike {
  readonly code?: string;
}

export async function run(context: {
  readonly input: unknown;
  readonly memory?: {
    readonly get: (binding: string, key: string) => Promise<MemoryRecordView>;
    readonly set: (
      binding: string,
      key: string,
      value: unknown,
    ) => Promise<MemoryRecordView>;
  };
}): Promise<{
  readonly echoed: unknown;
  readonly memoryValue: unknown | null;
  readonly memoryRevision: number | null;
  readonly writeBlocked: boolean;
  readonly writeErrorCode: string | null;
}> {
  const input = context.input as { memoryKey?: string };
  const memoryKey = input.memoryKey ?? "greeting";

  let memoryValue: unknown | null = null;
  let memoryRevision: number | null = null;
  let writeBlocked = false;
  let writeErrorCode: string | null = null;

  if (context.memory !== undefined) {
    try {
      const record = await context.memory.get("store", memoryKey);
      memoryValue = record.value;
      memoryRevision = record.revision;
    } catch {
      memoryValue = null;
      memoryRevision = null;
    }

    try {
      await context.memory.set("store", memoryKey, { overwritten: true });
    } catch (error) {
      writeBlocked = true;
      writeErrorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as MemoryCapabilityErrorLike).code === "string"
          ? (error as MemoryCapabilityErrorLike).code!
          : null;
    }
  }

  return {
    echoed: context.input,
    memoryValue,
    memoryRevision,
    writeBlocked,
    writeErrorCode,
  };
}
