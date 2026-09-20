import { Readable } from "node:stream";

import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

export class FakeS3NotFoundError extends Error {
  constructor() {
    super("NotFound");
    this.name = "NotFound";
  }
}

interface MultipartState {
  readonly parts: Map<number, Buffer>;
}

export class FakeS3Client {
  readonly objects = new Map<string, Buffer>();
  readonly commands: unknown[] = [];
  readonly multipartUploads = new Map<string, MultipartState>();
  private uploadCounter = 0;

  send = async (command: unknown): Promise<unknown> => {
    this.commands.push(command);
    const commandName = commandNameOf(command);

    if (commandName === "PutObjectCommand") {
      const input = (command as PutObjectCommand).input;
      const key = input.Key;
      if (key === undefined) {
        throw new Error("Missing object key.");
      }
      this.objects.set(key, await bodyToBuffer(input.Body));
      return {};
    }

    if (commandName === "CreateMultipartUploadCommand") {
      const input = (command as CreateMultipartUploadCommand).input;
      const key = input.Key;
      if (key === undefined) {
        throw new Error("Missing object key.");
      }
      const uploadId = `upload-${String(++this.uploadCounter)}`;
      this.multipartUploads.set(uploadId, { parts: new Map() });
      return { UploadId: uploadId, Key: key };
    }

    if (commandName === "UploadPartCommand") {
      const input = (command as UploadPartCommand).input;
      const uploadId = input.UploadId;
      const partNumber = input.PartNumber;
      const key = input.Key;
      if (
        uploadId === undefined ||
        partNumber === undefined ||
        key === undefined
      ) {
        throw new Error("Invalid multipart upload part.");
      }
      const state = this.multipartUploads.get(uploadId);
      if (state === undefined) {
        throw new FakeS3NotFoundError();
      }
      state.parts.set(partNumber, await bodyToBuffer(input.Body));
      return { ETag: `"part-${String(partNumber)}"` };
    }

    if (commandName === "CompleteMultipartUploadCommand") {
      const input = (command as CompleteMultipartUploadCommand).input;
      const uploadId = input.UploadId;
      const key = input.Key;
      if (uploadId === undefined || key === undefined) {
        throw new Error("Invalid multipart completion.");
      }
      const state = this.multipartUploads.get(uploadId);
      if (state === undefined) {
        throw new FakeS3NotFoundError();
      }
      const ordered = [...state.parts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, value]) => value);
      this.objects.set(key, Buffer.concat(ordered));
      this.multipartUploads.delete(uploadId);
      return { Bucket: input.Bucket, Key: key, ETag: '"complete"' };
    }

    if (commandName === "AbortMultipartUploadCommand") {
      const uploadId = (command as { input: { UploadId?: string } }).input
        .UploadId;
      if (uploadId !== undefined) {
        this.multipartUploads.delete(uploadId);
      }
      return {};
    }

    if (commandName === "HeadObjectCommand") {
      const key = (command as HeadObjectCommand).input.Key;
      if (key === undefined || !this.objects.has(key)) {
        throw new FakeS3NotFoundError();
      }
      return { ContentLength: this.objects.get(key)!.length };
    }

    if (commandName === "GetObjectCommand") {
      const key = (command as GetObjectCommand).input.Key;
      if (key === undefined || !this.objects.has(key)) {
        throw new FakeS3NotFoundError();
      }
      const payload = this.objects.get(key)!;
      return {
        ContentLength: payload.length,
        Body: Readable.from(payload),
      };
    }

    if (commandName === "DeleteObjectCommand") {
      const key = (command as DeleteObjectCommand).input.Key;
      if (key !== undefined) {
        this.objects.delete(key);
      }
      return {};
    }

    throw new Error(`Unexpected S3 command: ${commandName}`);
  };
}

export function asS3Client(fake: FakeS3Client): S3Client {
  const client = new S3Client({ region: "us-east-1" });
  client.send = fake.send.bind(fake) as typeof client.send;
  return client;
}

export function commandNameOf(command: unknown): string {
  if (
    command !== null &&
    typeof command === "object" &&
    "constructor" in command &&
    command.constructor !== null &&
    typeof command.constructor === "function" &&
    "name" in command.constructor
  ) {
    return String(command.constructor.name);
  }
  return "unknown";
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  if (typeof body === "string") {
    return Buffer.from(body);
  }
  throw new Error("Unsupported S3 body type in fake client.");
}
