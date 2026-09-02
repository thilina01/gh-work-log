import { RunResult } from "../types";

export function totalWipCount(report: RunResult): number {
  return report.statistics.perRepository.reduce((sum, repo) => sum + repo.wipCommitCount, 0);
}

export function totalMergeCommitCount(report: RunResult): number {
  return report.statistics.perRepository.reduce((sum, repo) => sum + repo.mergeCommitCount, 0);
}

export function totalExternalAuthorMergeCount(report: RunResult): number {
  return report.statistics.perRepository.reduce(
    (sum, repo) => sum + repo.externalAuthorMergeCount,
    0,
  );
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function humanize(value: string): string {
  return value.replace(/_/g, " ");
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttribute(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function titleCase(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}
