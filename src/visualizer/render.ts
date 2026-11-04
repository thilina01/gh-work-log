import { RunResult } from "../types";
import { renderBrowserScript } from "./browser-script";
import {
  renderActivityTab,
  renderCommitsTab,
  renderContributorsTab,
  renderHero,
  renderIssuesTab,
  renderMetricCards,
  renderOverviewTab,
  renderRepositoriesTab,
  renderTabStrip,
} from "./sections";
import { VISUALIZER_STYLES } from "./styles";

export function renderHtmlReport(report: RunResult): string {
  const dashboardData = {
    metadata: report.metadata,
    summary: report.statistics.summary,
    discovery: report.statistics.discovery,
    skippedByCategory: report.statistics.skippedByCategory,
    highlights: report.statistics.highlights,
    timeSeries: report.statistics.timeSeries,
    perRepository: report.statistics.perRepository,
    contributors: report.statistics.contributors,
    failures: report.failures,
    skippedRepositories: report.statistics.skippedRepositories,
    commits: report.data,
    ...(report.workTracking
      ? {
          workTasks: Object.fromEntries(
            Object.values(report.workTracking.tasks).map((task) => [
              task.key,
              { title: task.title, url: task.url, status: task.status },
            ]),
          ),
        }
      : {}),
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GitHub Work Log Report</title>
    <style>
${VISUALIZER_STYLES}
    </style>
  </head>
  <body>
    <div class="page">
      <div class="page-topbar">
        <div class="topbar-left">
          <button id="copy-summary-button" class="topbar-btn" type="button">Copy Markdown Summary</button>
        </div>
        <div class="topbar-right">
          <button id="hero-toggle" class="topbar-btn" type="button">Compact Header</button>
          <button id="theme-toggle" class="theme-toggle" type="button">Dark Theme</button>
        </div>
      </div>
      <div id="hero-container">
        ${renderHero(report)}
        ${renderMetricCards(report)}
      </div>
      <div id="hero-compact-bar" class="panel hero-compact-bar" style="display: none;">
        <div class="hero-compact-content">
          <strong>${report.metadata.reportMode === "organization" ? "All contributors" : report.metadata.targetAuthor}</strong> &bull;
          <span>${report.statistics.summary.uniqueCommits} commits</span> &bull;
          <span>${report.statistics.summary.repositoriesWithCommits} repositories</span> &bull;
          <span>${report.metadata.since.slice(0, 10)} to ${report.metadata.until.slice(0, 10)}</span>
        </div>
        <button id="hero-expand-btn" class="topbar-btn" type="button">Expand Header &#9660;</button>
      </div>
      ${renderTabStrip(report.metadata.reportMode === "organization")}
      ${renderOverviewTab(report)}
      ${renderActivityTab(report)}
      ${report.metadata.reportMode === "organization" ? renderContributorsTab(report) : ""}
      ${renderRepositoriesTab(report)}
      ${renderIssuesTab(report)}
      ${renderCommitsTab(report)}
      <div id="chart-tooltip" class="chart-tooltip" style="display: none;"></div>
      <p class="footer-note">
        This file is fully standalone. Re-run the visualizer with a fresh JSON export whenever you want an updated dashboard.
      </p>
    </div>
    <script>
${renderBrowserScript(dashboardData)}
    </script>
  </body>
</html>`;
}
