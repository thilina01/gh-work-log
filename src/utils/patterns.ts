import { BranchMatcher } from "../types";

const SPECIAL_REGEX = /[|\\{}()[\]^$+?.]/g;

export function compileBranchPatterns(inputs: string[]): BranchMatcher[] {
  return inputs.map((input) => compileBranchPattern(input));
}

export function compileBranchPattern(input: string): BranchMatcher {
  const [rawMode = "", ...rest] = input.split(":");
  const hasMode = rest.length > 0 && isPatternMode(rawMode);
  const mode = hasMode ? rawMode : "glob";
  const value = hasMode ? rest.join(":") : input;

  if (!value) {
    throw new Error(`Branch pattern "${input}" is missing a value.`);
  }

  switch (mode) {
    case "glob": {
      const regex = globToRegExp(value);
      return {
        mode,
        input,
        test(branch: string): boolean {
          return regex.test(branch);
        },
      };
    }
    case "prefix":
      return {
        mode,
        input,
        test(branch: string): boolean {
          return branch.startsWith(value);
        },
      };
    case "regex": {
      const regex = new RegExp(value);
      return {
        mode,
        input,
        test(branch: string): boolean {
          return regex.test(branch);
        },
      };
    }
    default:
      throw new Error(`Unsupported branch pattern mode "${mode}".`);
  }
}

export function matchesBranch(branch: string, patterns: BranchMatcher[]): boolean {
  if (patterns.length === 0) {
    return true;
  }

  return patterns.some((pattern) => pattern.test(branch));
}

function globToRegExp(value: string): RegExp {
  const escaped = value
    .replace(SPECIAL_REGEX, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  return new RegExp(`^${escaped}$`);
}

function isPatternMode(value: string): value is BranchMatcher["mode"] {
  return value === "glob" || value === "prefix" || value === "regex";
}
