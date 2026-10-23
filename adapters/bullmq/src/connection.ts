import { Redis } from "ioredis";

export type ValkeyConnection = Redis;

export function createValkeyConnection(url: string): ValkeyConnection {
  const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  connection.on("error", () => {
    // Command paths and explicit shutdown surface failures; avoid unhandled
    // error events while ioredis reconnects during process teardown.
  });
  return connection;
}

/** Errors that commonly surface while closing an already-terminated Redis client. */
export function isIgnorableValkeyTeardownError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("connection is closed") ||
    message.includes("connection closed") ||
    message.includes("socket closed") ||
    message.includes("epipe")
  );
}

export async function closeValkeyResource(
  close: () => Promise<void>,
): Promise<void> {
  try {
    await close();
  } catch (error) {
    if (!isIgnorableValkeyTeardownError(error)) {
      throw error;
    }
  }
}

export async function closeValkeyConnection(
  connection: Pick<ValkeyConnection, "status" | "quit" | "disconnect">,
): Promise<void> {
  if (connection.status === "end" || connection.status === "close") {
    return;
  }
  try {
    await connection.quit();
  } catch (error) {
    if (!isIgnorableValkeyTeardownError(error)) {
      connection.disconnect();
      throw error;
    }
    connection.disconnect();
  }
}

export async function pingValkeyConnection(
  connection: Pick<ValkeyConnection, "ping">,
): Promise<void> {
  const response = await connection.ping();
  if (response !== "PONG") {
    throw new Error("Valkey ping did not return PONG.");
  }
}
