const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/;

export function validateProjectName(projectName: string): void {
  if (projectName.length === 0) {
    throw new Error("Project name is required.");
  }
  if (projectName.length > 64) {
    throw new Error("Project name must be at most 64 characters.");
  }
  if (
    projectName.includes("/") ||
    projectName.includes("\\") ||
    projectName.includes("..") ||
    projectName.includes("\0")
  ) {
    throw new Error(
      "Project name must not contain path separators or traversal segments.",
    );
  }
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    throw new Error(
      "Project name must start with a lowercase letter and use only lowercase letters, digits, and hyphens.",
    );
  }
}

export function displayNameFromProjectName(projectName: string): string {
  return projectName
    .split("-")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
