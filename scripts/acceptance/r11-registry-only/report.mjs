/** @typedef {"PASS" | "FAIL" | "NOT_RUN" | "BLOCKED"} JourneyStatus */

/**
 * @typedef {object} JourneyResult
 * @property {string} id
 * @property {string} title
 * @property {JourneyStatus} status
 * @property {string} [detail]
 * @property {Record<string, unknown>} [evidence]
 */

export class AcceptanceReport {
  /** @type {JourneyResult[]} */
  #journeys = [];

  /**
   * @param {string} id
   * @param {string} title
   * @param {JourneyStatus} status
   * @param {object} [options]
   * @param {string} [options.detail]
   * @param {Record<string, unknown>} [options.evidence]
   */
  record(id, title, status, options = {}) {
    this.#journeys.push({
      id,
      title,
      status,
      detail: options.detail,
      evidence: options.evidence,
    });
    const prefix = status === "PASS" ? "PASS" : status;
    console.log(
      `[${prefix}] ${id}: ${title}${options.detail ? ` — ${options.detail}` : ""}`,
    );
  }

  /** @returns {JourneyResult[]} */
  journeys() {
    return [...this.#journeys];
  }

  exitCode() {
    if (this.#journeys.some((j) => j.status === "FAIL")) {
      return 1;
    }
    if (this.#journeys.some((j) => j.status === "BLOCKED")) {
      return 2;
    }
    return 0;
  }

  summaryJson(extra = {}) {
    return {
      acceptance: "r11-registry-only",
      release: "1.1.0-rc.4",
      journeys: this.#journeys,
      ...extra,
    };
  }
}
