/** Human-readable requirement for registry write actions in the Console. */
export function describeControlPlaneWriteRoleRequirement(): string {
  return "Creating or publishing agents requires a DEVELOPER, EDITOR, ADMIN, or OWNER role with write access.";
}
