export class CookieJar {
  /** @type {Map<string, string>} */
  store = new Map();

  /** @param {Record<string, string | string[] | undefined>} headers */
  absorbFromHeaders(headers) {
    const raw = headers["set-cookie"];
    const lines = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const line of lines) {
      this.absorbSetCookieLine(line);
    }
  }

  /** @param {Response} response */
  absorb(response) {
    const headers = response.headers;
    const raw =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")]
          : [];
    for (const line of raw) {
      this.absorbSetCookieLine(line);
    }
  }

  /** @param {string} line */
  absorbSetCookieLine(line) {
    const pair = line.split(";")[0]?.trim();
    if (!pair) {
      return;
    }
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      return;
    }
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!value || line.toLowerCase().includes("max-age=0")) {
      this.store.delete(name);
    } else {
      this.store.set(name, value);
    }
  }

  header() {
    if (this.store.size === 0) {
      return undefined;
    }
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
