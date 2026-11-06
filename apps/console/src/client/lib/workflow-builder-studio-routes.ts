/** Routes that use the full-width Workflow Studio builder layout. */
export function isWorkflowStudioBuilderPath(pathname: string): boolean {
  if (pathname === "/workflows/new" || pathname === "/workflows/new/describe") {
    return true;
  }
  return /^\/workflows\/[^/]+\/versions\/new\/?$/.test(pathname);
}
