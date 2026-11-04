/**
 * Text helpers for work tracking: issue keys, issue references, Markdown
 * body sections and trailer lines. Pure functions; no GitHub access.
 */

const EMPTY_VALUES = new Set(["", "-", "_no response_", "no response"]);

export function issueKey(repository: string, number: number): string {
  return `${repository}#${number}`;
}

export function parseIssueKey(key: string): { repository: string; number: number } | null {
  const match = /^([^/\s#]+\/[^/\s#]+)#(\d+)$/.exec(key);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { repository: match[1], number: Number(match[2]) };
}

/** Sort keys by repository, then numerically by issue number. */
export function compareIssueKeys(left: string, right: string): number {
  const a = parseIssueKey(left);
  const b = parseIssueKey(right);
  if (!a || !b) {
    return left.localeCompare(right);
  }
  return a.repository.localeCompare(b.repository) || a.number - b.number;
}

/**
 * Resolves an issue reference such as `owner/repo#12`, `#12`, or an issue or
 * pull request URL. A bare `#12` resolves against `contextRepository`, as on
 * GitHub.
 */
export function parseIssueReference(
  text: string,
  contextRepository: string | null,
): string | null {
  const value = text.trim();
  const url = /github\.com\/([^/\s]+\/[^/\s]+)\/(?:issues|pull)\/(\d+)/i.exec(value);
  if (url?.[1] && url[2]) {
    return issueKey(url[1], Number(url[2]));
  }
  const qualified = /(?:^|[\s(])([\w.-]+\/[\w.-]+)#(\d+)\b/.exec(` ${value}`);
  if (qualified?.[1] && qualified[2]) {
    return issueKey(qualified[1], Number(qualified[2]));
  }
  const bare = /(?:^|[\s(])#(\d+)\b/.exec(` ${value}`);
  if (bare?.[1] && contextRepository) {
    return issueKey(contextRepository, Number(bare[1]));
  }
  return null;
}

/** Applies a pattern with one capture group to a branch name and returns the number it captures. */
export function matchBranchNumber(branch: string, pattern: RegExp | null): number | null {
  if (!pattern) {
    return null;
  }
  const match = pattern.exec(branch);
  const captured = match?.[1];
  if (!captured || !/^\d+$/.test(captured)) {
    return null;
  }
  return Number(captured);
}

/**
 * Reads `Name: value` lines for the configured trailer names. Names match
 * case-insensitively; the first occurrence wins; results use the configured
 * spelling as keys.
 */
export function parseTrailers(body: string, names: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const wanted = new Map(names.map((name) => [normalizeName(name), name]));
  for (const line of normalizeNewlines(body).split("\n")) {
    const match = /^\s*([A-Za-z][\w -]*?)\s*:\s*(\S.*?)\s*$/.exec(line);
    if (!match?.[1] || !match[2]) {
      continue;
    }
    const name = wanted.get(normalizeName(match[1]));
    if (name && result[name] === undefined) {
      result[name] = match[2];
    }
  }
  return result;
}

export interface ParsedBody {
  sections: Record<string, string>;
  fields: Record<string, string>;
}

/**
 * Splits a Markdown body into the configured sections and single-value
 * fields. Recognized headings are `#`-style headings (issue forms) and lines
 * that are entirely bold (hand-written bodies). Fields are also read from
 * footer lines such as `> Requested by : Sales`.
 *
 * Only headings that match a configured name start a new part; other headings
 * stay inside the current section, so no text is lost. Text before the first
 * recognized heading is ignored. Lines matching `stripLines` are removed.
 */
export function parseBody(
  body: string,
  options: { sections: string[]; fields: string[]; stripLines?: RegExp[] },
): ParsedBody {
  const sectionNames = new Map(options.sections.map((name) => [normalizeName(name), name]));
  const fieldNames = new Map(options.fields.map((name) => [normalizeName(name), name]));
  const collected = new Map<string, { kind: "section" | "field"; name: string; lines: string[] }>();
  let current: { kind: "section" | "field"; name: string; lines: string[] } | null = null;

  for (const line of normalizeNewlines(body).split("\n")) {
    const footer = /^\s*>\s*([^:]+?)\s*:\s*(.*?)\s*$/.exec(line);
    const footerName = footer?.[1] ? fieldNames.get(normalizeName(footer[1])) : undefined;
    if (footerName) {
      const value = cleanText(footer?.[2] ?? "");
      if (value && !collected.has(`field:${footerName}`)) {
        collected.set(`field:${footerName}`, { kind: "field", name: footerName, lines: [value] });
      }
      current = null;
      continue;
    }

    const heading = readHeading(line);
    if (heading !== null) {
      const normalized = normalizeName(heading);
      const sectionName = sectionNames.get(normalized);
      const fieldName = fieldNames.get(normalized);
      if (sectionName || fieldName) {
        const kind = sectionName ? "section" : "field";
        const name = (sectionName ?? fieldName) as string;
        const id = `${kind}:${name}`;
        const existing = collected.get(id);
        current = existing ?? { kind, name, lines: [] };
        if (!existing) {
          collected.set(id, current);
        }
        continue;
      }
      if (current?.kind === "field") {
        // A field holds a single value; any other heading ends it.
        current = null;
        continue;
      }
    }

    if (current && !options.stripLines?.some((pattern) => pattern.test(line))) {
      current.lines.push(line);
    }
  }

  const sections: Record<string, string> = {};
  const fields: Record<string, string> = {};
  for (const name of options.sections) {
    const value = dropTrailingHeadings(cleanText(collected.get(`section:${name}`)?.lines.join("\n") ?? ""));
    if (value) {
      sections[name] = value;
    }
  }
  for (const name of options.fields) {
    const value = cleanText(collected.get(`field:${name}`)?.lines.join("\n") ?? "");
    if (value) {
      fields[name] = value;
    }
  }
  return { sections, fields };
}

/**
 * Removes images, HTML comments and form placeholders, normalizes line
 * endings, and trims the result. Returns "" for empty or placeholder text.
 */
export function cleanText(text: string): string {
  const cleaned = normalizeNewlines(text)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return EMPTY_VALUES.has(cleaned.toLowerCase()) ? "" : cleaned;
}

/** Removes headings left with no content (for example a "Screenshots" heading whose images were removed). */
function dropTrailingHeadings(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1] ?? "";
    if (last.trim() === "" || readHeading(last) !== null) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join("\n");
}

function readHeading(line: string): string | null {
  const hash = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
  if (hash?.[1]) {
    return hash[1];
  }
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(line);
  if (bold?.[1]) {
    return bold[1];
  }
  return null;
}

function normalizeName(name: string): string {
  return name
    .replace(/[*_:]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
