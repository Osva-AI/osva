import {
  OSVA_EXAMPLE_CATALOG,
  type ExampleCategory,
  type ExampleComplexity,
  type OsvaExampleCatalogEntry,
} from "./osva-examples-catalog";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "for",
  "to",
  "me",
  "my",
  "i",
  "we",
  "you",
  "your",
  "would",
  "like",
  "do",
  "with",
  "on",
  "in",
  "of",
  "is",
  "it",
  "this",
  "that",
  "please",
  "help",
  "want",
  "need",
  "ai",
  "osva",
]);

/** Minimum weighted score to treat the top match as reliable. */
export const GOAL_MATCH_MIN_RELIABLE_SCORE = 3;

export const SUGGESTED_GOAL_PROMPTS: readonly {
  readonly label: string;
  readonly goal: string;
}[] = [
  { label: "Analyze customer feedback", goal: "analyze customer feedback" },
  { label: "Research a market", goal: "research a market" },
  { label: "Automate customer support", goal: "automate customer support" },
  { label: "Create an SEO audit", goal: "create an SEO audit" },
  {
    label: "Analyze growth opportunities",
    goal: "analyze growth opportunities",
  },
  {
    label: "Generate a business report",
    goal: "generate a business report",
  },
  {
    label: "Build an approval workflow",
    goal: "build an approval workflow",
  },
];

export interface ExampleMatch {
  readonly exampleId: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly reasons: readonly string[];
}

export interface GoalMatchResult {
  readonly normalizedQuery: string;
  readonly tokens: readonly string[];
  readonly matches: readonly ExampleMatch[];
  readonly hasReliableMatch: boolean;
}

export function normalizeGoalText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeGoal(input: string): string[] {
  const normalized = normalizeGoalText(input);
  if (normalized.length === 0) {
    return [];
  }
  const tokens: string[] = [];
  for (const part of normalized.split(" ")) {
    if (part.length === 0) {
      continue;
    }
    if (STOP_WORDS.has(part)) {
      continue;
    }
    tokens.push(part);
    if (part.includes("-")) {
      for (const sub of part.split("-")) {
        if (sub.length > 1 && !STOP_WORDS.has(sub)) {
          tokens.push(sub);
        }
      }
    }
  }
  return [...new Set(tokens)];
}

function termVariants(term: string): string[] {
  const variants = [term];
  if (term.endsWith("s") && term.length > 3) {
    variants.push(term.slice(0, -1));
  }
  if (term.endsWith("ing") && term.length > 5) {
    variants.push(term.slice(0, -3));
  }
  if (term.endsWith("ed") && term.length > 4) {
    variants.push(term.slice(0, -2));
  }
  return variants;
}

function scoreEntry(
  entry: OsvaExampleCatalogEntry,
  tokens: readonly string[],
): ExampleMatch | undefined {
  let score = 0;
  const matchedTerms = new Set<string>();
  const reasons: string[] = [];

  const weightedTerms: { term: string; weight: number; label: string }[] = [];
  for (const keyword of entry.keywords) {
    weightedTerms.push({ term: keyword, weight: 2, label: "keyword" });
  }
  for (const word of entry.title.toLowerCase().split(/\s+/)) {
    if (word.length > 2) {
      weightedTerms.push({ term: word, weight: 1, label: "title" });
    }
  }

  for (const token of tokens) {
    for (const { term, weight, label } of weightedTerms) {
      const termNorm = normalizeGoalText(term);
      if (termNorm.length === 0) {
        continue;
      }
      const termTokens = termNorm.split(" ");
      const directMatch =
        termNorm === token ||
        termTokens.includes(token) ||
        termVariants(token).some(
          (v) => termNorm.includes(v) || termTokens.includes(v),
        ) ||
        termVariants(termNorm).some((v) => v === token || v.includes(token));

      if (directMatch) {
        score += weight;
        matchedTerms.add(term);
        if (!reasons.includes(`${label}: ${term}`)) {
          reasons.push(`${label}: ${term}`);
        }
      }
    }
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    exampleId: entry.id,
    score,
    matchedTerms: [...matchedTerms],
    reasons,
  };
}

export function matchGoalToExamples(
  goal: string,
  options?: { readonly maxResults?: number },
): GoalMatchResult {
  const maxResults = options?.maxResults ?? 5;
  const normalizedQuery = normalizeGoalText(goal);
  const tokens = tokenizeGoal(goal);

  if (tokens.length === 0) {
    return {
      normalizedQuery,
      tokens,
      matches: [],
      hasReliableMatch: false,
    };
  }

  const matches = OSVA_EXAMPLE_CATALOG.map((entry) => scoreEntry(entry, tokens))
    .filter((m): m is ExampleMatch => m !== undefined)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.exampleId.localeCompare(b.exampleId);
    })
    .slice(0, maxResults);

  const topScore = matches[0]?.score ?? 0;
  return {
    normalizedQuery,
    tokens,
    matches,
    hasReliableMatch: topScore >= GOAL_MATCH_MIN_RELIABLE_SCORE,
  };
}

export function filterCatalogEntries(options: {
  readonly query?: string;
  readonly category?: ExampleCategory | "all";
  readonly complexity?: ExampleComplexity | "all";
}): OsvaExampleCatalogEntry[] {
  const q = options.query?.trim() ?? "";
  let entries = [...OSVA_EXAMPLE_CATALOG];
  if (options.category !== undefined && options.category !== "all") {
    entries = entries.filter((e) => e.category === options.category);
  }
  if (options.complexity !== undefined && options.complexity !== "all") {
    entries = entries.filter((e) => e.complexity === options.complexity);
  }
  if (q.length > 0) {
    const result = matchGoalToExamples(q, { maxResults: entries.length });
    const allowed = new Set(entries.map((e) => e.id));
    const ranked = result.matches
      .filter((m) => allowed.has(m.exampleId))
      .map((m) => entries.find((e) => e.id === m.exampleId)!);
    const rankedIds = new Set(ranked.map((e) => e.id));
    const rest = entries
      .filter((e) => !rankedIds.has(e.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    return [...ranked, ...rest];
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title));
}
