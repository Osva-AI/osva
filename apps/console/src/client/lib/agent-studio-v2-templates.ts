export interface AgentStudioTemplateIdea {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly suggestedName: string;
  readonly instructions: string;
}

/** Text pre-fill only — not a deployable manifest import. */
export const AGENT_STUDIO_TEMPLATE_IDEAS: readonly AgentStudioTemplateIdea[] = [
  {
    id: "customer-support",
    title: "Customer support helper",
    description:
      "Answer common billing and account questions with a friendly tone.",
    suggestedName: "Customer support helper",
    instructions:
      "You help customers with billing, subscriptions, and account access. Be concise, empathetic, and ask clarifying questions when details are missing. If you cannot resolve an issue, explain what information the human team will need.",
  },
  {
    id: "research-summarizer",
    title: "Research summarizer",
    description:
      "Turn long notes or articles into clear takeaways and next steps.",
    suggestedName: "Research summarizer",
    instructions:
      "You summarize research materials for busy teammates. Produce a short overview, bullet key findings, and list suggested next steps. Call out uncertainty when sources conflict.",
  },
  {
    id: "seo-review",
    title: "SEO review assistant",
    description:
      "Review page copy for search clarity, headings, and actionable fixes.",
    suggestedName: "SEO review assistant",
    instructions:
      "You review marketing page copy for SEO and readability. Highlight title and heading issues, missing intent, and concrete rewrite suggestions. Do not invent analytics data.",
  },
] as const;
