import {
  KNOWLEDGE_INDEX_STATES,
  type KnowledgeIndexState,
} from "@osva/contracts";

import { InvalidKnowledgeIndexTransitionError } from "./errors.js";

export const LEGAL_KNOWLEDGE_INDEX_TRANSITIONS: ReadonlyArray<
  readonly [KnowledgeIndexState, KnowledgeIndexState]
> = [
  ["PENDING", "RUNNING"],
  ["RUNNING", "READY"],
  ["RUNNING", "FAILED"],
  ["FAILED", "PENDING"],
];

const LEGAL_KNOWLEDGE_INDEX_TRANSITION_KEYS = new Set(
  LEGAL_KNOWLEDGE_INDEX_TRANSITIONS.map(([from, to]) =>
    transitionKey(from, to),
  ),
);

export function isKnowledgeIndexState(
  value: string,
): value is KnowledgeIndexState {
  return (KNOWLEDGE_INDEX_STATES as readonly string[]).includes(value);
}

export function isLegalKnowledgeIndexTransition(
  from: KnowledgeIndexState,
  to: KnowledgeIndexState,
): boolean {
  return LEGAL_KNOWLEDGE_INDEX_TRANSITION_KEYS.has(transitionKey(from, to));
}

export function assertLegalKnowledgeIndexTransition(
  from: KnowledgeIndexState,
  to: KnowledgeIndexState,
): void {
  if (!isLegalKnowledgeIndexTransition(from, to)) {
    throw new InvalidKnowledgeIndexTransitionError(from, to);
  }
}

function transitionKey(
  from: KnowledgeIndexState,
  to: KnowledgeIndexState,
): string {
  return `${from}->${to}`;
}
