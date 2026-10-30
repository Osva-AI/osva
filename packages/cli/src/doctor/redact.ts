const API_KEY_PATTERN = /osva_ak_[A-Za-z0-9._-]+/g;
const BEARER_PATTERN = /Bearer\s+\S+/gi;
const URL_CREDENTIALS_PATTERN = /\/\/[^/\s:@]+:[^@\s/]+@/g;
const ENV_SECRET_ASSIGNMENT_PATTERN =
  /(POSTGRES_PASSWORD|OSVA_AUTH_SECRET|VALKEY_PASSWORD)=(\S+)/g;

export function redactSecrets(text: string): string {
  return text
    .replace(URL_CREDENTIALS_PATTERN, "//***:***@")
    .replace(BEARER_PATTERN, "Bearer ***")
    .replace(API_KEY_PATTERN, "osva_ak_***")
    .replace(ENV_SECRET_ASSIGNMENT_PATTERN, "$1=***");
}
