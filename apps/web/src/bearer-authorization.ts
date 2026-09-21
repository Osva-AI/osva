export function parseBearerAuthorization(
  authorizationHeader: string | readonly string[] | undefined,
): string | undefined {
  const authorization = headerValue(authorizationHeader);
  if (authorization === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match === null) {
    return undefined;
  }

  const token = match[1]!.trim();
  return token.length === 0 ? undefined : token;
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value[0];
}
