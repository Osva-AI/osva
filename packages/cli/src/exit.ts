/**
 * Terminate the CLI after async I/O. process.exit() on Windows while libuv is
 * closing HTTP handles can abort with UV_HANDLE_CLOSING (Node 24+). Doctor uses
 * node:http with Connection: close; other commands rely on a natural drain.
 */
export async function exitCli(code: number): Promise<void> {
  process.exitCode = code;
}
