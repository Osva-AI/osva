const DOCKER_STREAM_HEADER_SIZE = 8;
const DOCKER_STREAM_TYPE_STDOUT = 1;
const DOCKER_STREAM_TYPE_STDERR = 2;

export interface BoundedDemuxOptions {
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface DemuxedDockerStreamOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface BoundedUtf8StreamOutput {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export async function readBoundedUtf8Stream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
): Promise<BoundedUtf8StreamOutput> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      if (truncated) {
        return;
      }
      if (bytes + chunk.length > maxBytes) {
        const remaining = maxBytes - bytes;
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
        }
        truncated = true;
        bytes = maxBytes;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    });
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", reject);
  });

  return {
    text: Buffer.concat(chunks).toString("utf8"),
    bytes,
    truncated,
  };
}

/**
 * Parses Docker Engine multiplexed stdout/stderr framing (non-TTY logs/attach).
 */
export async function readDemuxedDockerStream(
  stream: NodeJS.ReadableStream,
  options: BoundedDemuxOptions,
): Promise<DemuxedDockerStreamOutput> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let pending = Buffer.alloc(0);

  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);

      while (pending.length >= DOCKER_STREAM_HEADER_SIZE) {
        const frameType = pending[0];
        const frameSize = pending.readUInt32BE(4);
        const frameEnd = DOCKER_STREAM_HEADER_SIZE + frameSize;
        if (pending.length < frameEnd) {
          break;
        }

        const payload = pending.subarray(DOCKER_STREAM_HEADER_SIZE, frameEnd);
        pending = pending.subarray(frameEnd);

        if (frameType === DOCKER_STREAM_TYPE_STDOUT) {
          if (stdoutTruncated) {
            continue;
          }
          if (stdoutBytes + payload.length > options.maxStdoutBytes) {
            const remaining = options.maxStdoutBytes - stdoutBytes;
            if (remaining > 0) {
              stdoutChunks.push(payload.subarray(0, remaining));
            }
            stdoutTruncated = true;
            stdoutBytes = options.maxStdoutBytes;
            continue;
          }
          stdoutChunks.push(payload);
          stdoutBytes += payload.length;
          continue;
        }

        if (frameType === DOCKER_STREAM_TYPE_STDERR) {
          if (stderrTruncated) {
            continue;
          }
          if (stderrBytes + payload.length > options.maxStderrBytes) {
            const remaining = options.maxStderrBytes - stderrBytes;
            if (remaining > 0) {
              stderrChunks.push(payload.subarray(0, remaining));
            }
            stderrTruncated = true;
            stderrBytes = options.maxStderrBytes;
            continue;
          }
          stderrChunks.push(payload);
          stderrBytes += payload.length;
        }
      }
    });
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", reject);
  });

  return {
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    stdoutBytes,
    stderrBytes,
    stdoutTruncated,
    stderrTruncated,
  };
}
