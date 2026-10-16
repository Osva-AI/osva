import type { InitTemplateVars } from "./types.js";
import { displayNameFromProjectName } from "./validate-project-name.js";

export function buildTemplateVars(projectName: string): InitTemplateVars {
  const entrypoint = `${projectName}.js`;
  return {
    agentKey: projectName,
    agentName: displayNameFromProjectName(projectName),
    packageName: projectName,
    entrypoint,
  };
}

export function renderTemplateString(
  source: string,
  vars: InitTemplateVars,
): string {
  return source
    .replaceAll("{{AGENT_KEY}}", vars.agentKey)
    .replaceAll("{{AGENT_NAME}}", vars.agentName)
    .replaceAll("{{PACKAGE_NAME}}", vars.packageName)
    .replaceAll("{{ENTRYPOINT}}", vars.entrypoint);
}
