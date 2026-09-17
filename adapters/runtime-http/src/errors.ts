export class SecretNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Secret '${key}' was not found.`);
    this.name = "SecretNotFoundError";
    this.key = key;
  }
}

export class OversizedBodyError extends Error {
  constructor() {
    super("Runtime protocol body exceeds the maximum size.");
    this.name = "OversizedBodyError";
  }
}
