import { RunResult } from "../types";
import { renderBrowserScript } from "./browser-script";
import {
  renderActivityTab,
  renderCommitsTab,
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
    timeSeries: report.statistics.timeSeries,
    perRepository: report.statistics.perRepository,
    failures: report.failures,
    skippedRepositories: report.statistics.skippedRepositories,
    commits: report.data,
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
        <button id="theme-toggle" class="theme-toggle" type="button">Dark Theme</button>
      </div>
      ${renderHero(report)}
      ${renderMetricCards(report)}
      ${renderTabStrip()}
      ${renderOverviewTab(report)}
      ${renderActivityTab(report)}
      ${renderRepositoriesTab(report)}
      ${renderIssuesTab(report)}
      ${renderCommitsTab(report)}
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
