/** Write all bytes to stdout and wait until the write completes (Windows-safe shutdown). */
export function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    try {
      const accepted = process.stdout.write(text, "utf8", finish);
      if (accepted) {
        finish();
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
