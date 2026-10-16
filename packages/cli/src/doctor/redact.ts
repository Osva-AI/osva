const API_KEY_PATTERN = /osva_ak_[A-Za-z0-9._-]+/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;
const URL_CREDENTIALS_PATTERN = /\/\/[^/\s:@]+:[^@\s/]+@/g;

export function redactSecrets(text: string): string {
  return text
    .replace(URL_CREDENTIALS_PATTERN, "//***:***@")
    .replace(BEARER_PATTERN, "Bearer ***")
    .replace(API_KEY_PATTERN, "osva_ak_***");
}
