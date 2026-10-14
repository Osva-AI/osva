const SENSITIVE_KEY =
  /^(authorization|cookie|password|secret|token|api[_-]?key|osva_database_url|osva_valkey_url|otlp.*header)$/i;

export function redactString(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (/^postgres(?:ql)?:\/\//i.test(value)) {
    return redactDatabaseUrl(value);
  }
  if (/^redis:\/\//i.test(value)) {
    return redactRedisUrl(value);
  }
  if (/^Bearer\s+/i.test(value)) {
    return "Bearer [REDACTED]";
  }
  if (/^osva_ak_/i.test(value)) {
    return "osva_ak_[REDACTED]";
  }
  return value;
}

export function redactDatabaseUrl(url) {
  try {
    return url.replace(
      /^((?:postgres(?:ql)?|postgresql):\/\/)(?:[^:@/]*(?::[^@/]*)?@)/i,
      "$1[REDACTED]:[REDACTED]@",
    );
  } catch {
    return "[REDACTED_DATABASE_URL]";
  }
}

export function redactRedisUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "[REDACTED]";
    }
    return parsed.toString();
  } catch {
    return "[REDACTED_VALKEY_URL]";
  }
}

export function redactValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        if (typeof nested === "string") {
          const redacted = redactString(nested);
          output[key] = redacted === nested ? "[REDACTED]" : redacted;
        } else {
          output[key] = "[REDACTED]";
        }
        continue;
      }
      output[key] = redactValue(nested);
    }
    return output;
  }
  return value;
}
