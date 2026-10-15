export class HelloDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelloDeployError";
  }
}
