export function plainLanguageValidationMessage(message: string): string {
  const normalized = message.trim();
  if (/modelBinding 'primary' is not declared/i.test(normalized)) {
    return "Choose an AI model to continue.";
  }
  if (/instructions are required/i.test(normalized)) {
    return "Add instructions describing what your agent should do.";
  }
  if (
    /modelProfileVersionId/i.test(normalized) &&
    /required/i.test(normalized)
  ) {
    return "Select a model version from your workspace.";
  }
  if (/Binding name is required/i.test(normalized)) {
    return "Finish tool setup or remove the incomplete tool binding.";
  }
  if (/not available/i.test(normalized) && /version/i.test(normalized)) {
    return "A previously selected version is no longer available. Choose another.";
  }
  return normalized;
}

export function stageForFieldError(fieldKey: string): "describe" | "equip" {
  if (fieldKey === "instructions" || fieldKey === "manifestName") {
    return "describe";
  }
  return "equip";
}
