export class CanonicalAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalAgentError";
  }
}
