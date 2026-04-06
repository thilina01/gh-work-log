import { MessageCategory } from "./types";

const CONVENTIONAL_PREFIXES: Record<string, MessageCategory> = {
  feat: "feat",
  fix: "fix",
  refactor: "refactor",
  docs: "docs",
  test: "test",
  chore: "chore",
};

const KEYWORD_RULES: Array<[RegExp, MessageCategory]> = [
  [/\b(feature|add|introduce|implement)\b/i, "feat"],
  [/\b(fix|bug|hotfix|repair|resolve)\b/i, "fix"],
  [/\b(refactor|cleanup|restructure|simplify)\b/i, "refactor"],
  [/\b(docs?|readme|comment)\b/i, "docs"],
  [/\b(test|spec|assertion|coverage)\b/i, "test"],
  [/\b(chore|deps?|bump|ci|build|release)\b/i, "chore"],
];

export function classifyMessage(message: string): MessageCategory {
  const headline = normalizeHeadline(message);
  const conventional = headline.match(/^([a-z]+)(?:\([^)]*\))?!?:/i)?.[1]?.toLowerCase();
  if (conventional) {
    const category =
      CONVENTIONAL_PREFIXES[conventional as keyof typeof CONVENTIONAL_PREFIXES];
    if (category) {
      return category;
    }
  }

  for (const [pattern, category] of KEYWORD_RULES) {
    if (pattern.test(headline)) {
      return category;
    }
  }

  return "other";
}

export function normalizeHeadline(message: string): string {
  return message.split("\n")[0]?.trim() ?? "";
}
