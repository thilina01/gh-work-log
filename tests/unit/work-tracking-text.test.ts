import { describe, expect, it } from "vitest";
import {
  cleanText,
  compareIssueKeys,
  matchBranchNumber,
  parseBody,
  parseIssueReference,
  parseTrailers,
} from "../../src/work-tracking/text";
import { FORM_TASK_BODY, HAND_WRITTEN_TASK_BODY, PR_BODY } from "../helpers/work-tracking";

const TASK_OPTIONS = {
  sections: ["Description", "Requirements", "Acceptance Criteria"],
  fields: ["Requested by", "BA task"],
};

describe("work-tracking body parsing", () => {
  it("reads hand-written bold headings and footer fields", () => {
    const parsed = parseBody(HAND_WRITTEN_TASK_BODY, TASK_OPTIONS);
    expect(parsed.sections).toEqual({
      Description: "Show order history date by date.",
      Requirements: "- Use the selected store and date range.",
      "Acceptance Criteria": "- Each date is shown separately.\\",
    });
    expect(parsed.fields).toEqual({ "Requested by": "Sales", "BA task": "#77" });
  });

  it("reads issue-form headings, keeps unknown headings inside the section, and drops placeholders and images", () => {
    const parsed = parseBody(FORM_TASK_BODY, TASK_OPTIONS);
    expect(parsed.sections.Requirements).toBe("- Add the module.\n\n### Invoice Header\n\n- Invoice Number");
    expect(parsed.sections["Acceptance Criteria"]).toBe("- Invoices can be printed.");
    expect(parsed.fields).toEqual({ "Requested by": "Finance Department" });
    expect(JSON.stringify(parsed)).not.toContain("example.com");

    const trailing = parseBody("### Description\n\nText\n\n### Screenshots\n\n![x](https://example.com/c.png)", TASK_OPTIONS);
    expect(trailing.sections).toEqual({ Description: "Text" });
  });

  it("handles CRLF bodies, mixed heading styles, and stripped trailer lines", () => {
    const parsed = parseBody(PR_BODY, {
      sections: ["Summary", "Dev verification", "What to Review"],
      fields: [],
      stripLines: [/^\s*closes\s+#\d+\s*$/i, /^\s*Implementation-Issue\s*:/i, /^\s*Parent-Task\s*:/i],
    });
    expect(parsed.sections).toEqual({
      Summary: "Date filter added.",
      "Dev verification": "Verified on `dev` with feature image `wm-125-sub-173-abc12345-1-a1`.",
      "What to Review": "- The date filter query.",
    });
  });

  it("returns nothing for bodies without recognized headings", () => {
    expect(parseBody("Just some text", TASK_OPTIONS)).toEqual({ sections: {}, fields: {} });
    expect(cleanText("  _No response_ \r\n")).toBe("");
    expect(cleanText("a\n\n\n\nb <!-- hidden -->")).toBe("a\n\nb");
  });
});

describe("work-tracking references", () => {
  it("parses trailers case-insensitively with the configured spelling", () => {
    expect(parseTrailers(PR_BODY, ["Parent-Task", "Implementation-Issue", "Missing"])).toEqual({
      "Parent-Task": "acme/tasks#125",
      "Implementation-Issue": "#173",
    });
    expect(parseTrailers("parent-task:   #9\nParent-Task: #10", ["Parent-Task"])).toEqual({
      "Parent-Task": "#9",
    });
  });

  it("resolves qualified, bare, and URL issue references", () => {
    expect(parseIssueReference("acme/tasks#125", "acme/web")).toBe(
      "acme/tasks#125",
    );
    expect(parseIssueReference("#173", "acme/web")).toBe("acme/web#173");
    expect(parseIssueReference("#173", null)).toBeNull();
    expect(parseIssueReference("https://github.com/acme/tasks/issues/7", null)).toBe(
      "acme/tasks#7",
    );
    expect(parseIssueReference("none", "a/b")).toBeNull();
  });

  it("matches branch task numbers and sorts keys numerically", () => {
    const pattern = /-wm(\d+)-/;
    expect(matchBranchNumber("task/173-wm125-order-history", pattern)).toBe(125);
    expect(matchBranchNumber("task/173-order-history", pattern)).toBeNull();
    expect(matchBranchNumber("task/173-wm125-x", null)).toBeNull();
    expect(["a/b#10", "a/b#9", "a/a#100"].sort(compareIssueKeys)).toEqual(["a/a#100", "a/b#9", "a/b#10"]);
  });
});
