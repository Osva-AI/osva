export class ProjectDeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDeployError";
  }
}

export class ProjectConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectConfigurationError";
  }
}

export class ProjectStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectStateError";
  }
}
