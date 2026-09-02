import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { escapeHtml } from "../../src/visualizer/helpers";

function extractEscapeBrowserHtml(): (value: string) => string {
  const source = readFileSync(
    path.join(__dirname, "../../src/visualizer/browser-client.js"),
    "utf8",
  );
  const start = source.indexOf("function escapeBrowserHtml");
  if (start === -1) {
    throw new Error("escapeBrowserHtml not found in browser-client.js");
  }

  let depth = 0;
  let end = start;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    }
    if (source[index] === "}") {
      depth -= 1;
    }
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  return new Function(`${source.slice(start, end)}; return escapeBrowserHtml;`)() as (
    value: string,
  ) => string;
}

describe("escapeHtml / escapeBrowserHtml parity", () => {
  it("produce identical output for the same input", () => {
    const escapeBrowserHtml = extractEscapeBrowserHtml();
    const fixtures = [
      `& < > " ' plain text`,
      "<script>alert('x')</script>",
      "",
      "unicode: café — 日本語",
      `already &amp; escaped`,
    ];

    for (const value of fixtures) {
      expect(escapeBrowserHtml(value)).toBe(escapeHtml(value));
    }
  });
});
