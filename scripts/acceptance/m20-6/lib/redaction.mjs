const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-[A-Za-z0-9]{10,}/g,
  /OSVA_[A-Z0-9_]*API_KEY[A-Z0-9_]*/g,
  /osva-m12-3-sentinel-credential[^\s"]*/gi,
  /set-cookie:\s*[^\n]+/gi,
  /"password"\s*:\s*"[^"]+"/gi,
  /"apiKey"\s*:\s*"[^"]+"/gi,
];

/**
 * @param {string} text
 */
export function redactAcceptanceSecrets(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

/**
 * @param {unknown} value
 */
export function assertNoSecretLeak(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const redacted = redactAcceptanceSecrets(text);
  if (redacted.includes("sentinel-credential") || redacted.includes("sk-")) {
    throw new Error("Secret material detected in acceptance payload");
  }
}
