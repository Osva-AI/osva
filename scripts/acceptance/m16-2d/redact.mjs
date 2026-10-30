const API_KEY_PATTERN = /osva_ak_[A-Za-z0-9._-]+/g;
const SECRET_ASSIGNMENT =
  /(POSTGRES_PASSWORD|OSVA_AUTH_SECRET|VALKEY_PASSWORD)=(\S+)/g;

export function redactSecrets(text) {
  return String(text)
    .replace(API_KEY_PATTERN, "osva_ak_***")
    .replace(SECRET_ASSIGNMENT, "$1=***");
}

export function assertRedacted(text) {
  if (/osva_ak_[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+/.test(text)) {
    throw new Error("Expected redacted output still contains an API key.");
  }
}
