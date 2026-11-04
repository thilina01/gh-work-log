// Compiled to browser-client.js via `npm run generate:browser-client`.
// Edit this file, regenerate, and commit both files together.

interface DashboardCommitRow {
  repository: string;
  branch: string;
  scanBranch: string;
  sha: string;
  message: string;
  authoredDateTime: string;
  url: string;
  isWip: boolean;
  isMergeCommit: boolean;
  mergeIncludesExternalAuthor: boolean;
  authorLogin: string | null;
  authorName?: string | null;
  authorEmail: string | null;
  mergeBranchAuthorLogin: string | null;
  workLink?: { status: string; task: string | null };
}

interface DashboardWorkTask {
  title: string;
  url: string;
  status: string | null;
}

interface DashboardRepoRow {
  repository: string;
  commitCount: number;
  firstCommitAt: string;
  lastCommitAt: string;
}

interface DashboardContributorRow {
  login: string | null;
  commitCount: number;
  repositoryCount: number;
  additions?: number;
  deletions?: number;
}

interface DashboardData {
  commits: DashboardCommitRow[];
  workTasks?: Record<string, DashboardWorkTask>;
  perRepository?: DashboardRepoRow[];
  contributors?: DashboardContributorRow[];
  summary?: {
    uniqueCommits: number;
    repositoriesWithCommits: number;
    durationSeconds: number;
  };
  metadata?: {
    since: string;
    until: string;
    targetAuthor: string;
    authenticatedUser: string;
    reportMode?: "author" | "organization";
  };
  highlights?: {
    topRepositories?: Array<{ repository: string; commitCount: number }>;
    codeLevel?: {
      totalAdditions: number;
      totalDeletions: number;
      totalFilesChanged: number;
    };
  };
}

declare const DASHBOARD_DATA: DashboardData;

type Theme = "light" | "dark";
type SortDirection = "asc" | "desc";
interface SortState {
  key: string;
  direction: SortDirection;
}

interface ResolvedAuthor {
  value: string;
  source: "account" | "commit-name" | "unknown";
}

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing expected dashboard element #${id}.`);
  }
  return element as unknown as T;
}

const rows = DASHBOARD_DATA.commits.slice().sort((a, b) =>
  b.authoredDateTime.localeCompare(a.authoredDateTime) ||
  a.repository.localeCompare(b.repository) ||
  a.sha.localeCompare(b.sha)
);
const repoFilter = requireElement<HTMLSelectElement>("repo-filter");
const branchFilter = requireElement<HTMLSelectElement>("branch-filter");
const authorFilter = requireElement<HTMLSelectElement>("author-filter");
const wipFilter = requireElement<HTMLSelectElement>("wip-filter");
const mergeFilter = requireElement<HTMLSelectElement>("merge-filter");
const externalAuthorFilter = requireElement<HTMLSelectElement>("external-author-filter");
const searchInput = requireElement<HTMLInputElement>("commit-search");
const tableBody = requireElement<HTMLElement>("commit-table-body");
const resultsMeta = requireElement<HTMLElement>("commit-results-meta");
const countChip = requireElement<HTMLElement>("commit-count-chip");
const exportButton = requireElement<HTMLButtonElement>("export-csv-button");
const toggleAllButton = document.getElementById("toggle-all-button") as HTMLButtonElement | null;
const resetFiltersButton = document.getElementById("reset-filters-button") as HTMLButtonElement | null;
const copySummaryButton = document.getElementById("copy-summary-button") as HTMLButtonElement | null;
const heroToggle = document.getElementById("hero-toggle") as HTMLButtonElement | null;
const heroExpandBtn = document.getElementById("hero-expand-btn") as HTMLButtonElement | null;
const heroContainer = document.getElementById("hero-container");
const heroCompactBar = document.getElementById("hero-compact-bar");
const chartTooltip = document.getElementById("chart-tooltip");
const repoSummarySearch = document.getElementById("repo-summary-search") as HTMLInputElement | null;
const repoSummaryTbody = document.getElementById("repo-summary-tbody");
const repoSortHeaders = Array.from(document.querySelectorAll<HTMLElement>("[data-repo-sort-key]"));
const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll<HTMLElement>(".tab-panel"));
const columnControls = Array.from(document.querySelectorAll<HTMLInputElement>("[data-column-toggle]"));
const sortHeaders = Array.from(document.querySelectorAll<HTMLElement>("[data-sort-key]"));
const themeToggle = document.getElementById("theme-toggle");
const storageKey = "gh-work-log-theme";
const columnsStorageKey = "gh-work-log-columns-v2";
const heroCompactStorageKey = "gh-work-log-hero-compact";
const sortState: SortState = {
  key: "authoredDateTime",
  direction: "desc",
};

function formatShortDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatRepoName(repo: string): string {
  const slashIndex = repo.indexOf("/");
  if (slashIndex === -1) {
    return `<span class="repo-name">${escapeBrowserHtml(repo)}</span>`;
  }
  const org = repo.slice(0, slashIndex + 1);
  const name = repo.slice(slashIndex + 1);
  return `<span class="repo-org">${escapeBrowserHtml(org)}</span><span class="repo-name">${escapeBrowserHtml(name)}</span>`;
}

function resolveAuthor(row: DashboardCommitRow): ResolvedAuthor {
  if (row.isMergeCommit && row.mergeBranchAuthorLogin) {
    return { value: row.mergeBranchAuthorLogin, source: "account" };
  }

  if (row.authorLogin) {
    return { value: row.authorLogin, source: "account" };
  }
  if (row.authorEmail) {
    return { value: row.authorEmail, source: "account" };
  }
  const authorName = row.authorName?.trim();
  return authorName
    ? { value: authorName, source: "commit-name" }
    : { value: "Unknown", source: "unknown" };
}

function resolveAuthorLabel(row: DashboardCommitRow): string {
  return resolveAuthor(row).value;
}

function authorFilterKey(author: ResolvedAuthor): string {
  return `${author.source}:${author.value}`;
}

function formatAuthorExportValue(row: DashboardCommitRow): string {
  const author = resolveAuthor(row);
  return author.source === "commit-name"
    ? `${author.value} (unverified commit name)`
    : author.value;
}

const repositories = Array.from(new Set(rows.map((row) => row.repository))).sort();
const branches = Array.from(new Set(rows.map((row) => row.branch))).sort();
const authors = Array.from(
  new Map(rows.map((row) => {
    const author = resolveAuthor(row);
    return [authorFilterKey(author), author] as const;
  })).entries(),
).sort((left, right) => left[1].value.localeCompare(right[1].value));

for (const repo of repositories) {
  const option = document.createElement("option");
  option.value = repo;
  option.textContent = repo;
  repoFilter.appendChild(option);
}

for (const branch of branches) {
  const option = document.createElement("option");
  option.value = branch;
  option.textContent = branch;
  branchFilter.appendChild(option);
}

for (const [key, author] of authors) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent =
    author.source === "commit-name"
      ? `${author.value} (unverified commit name)`
      : author.value;
  authorFilter.appendChild(option);
}

interface ExportColumn {
  key: string;
  header: string;
  getValue: (row: DashboardCommitRow) => string;
}

const exportColumns: ExportColumn[] = [
  { key: "authored", header: "Authored", getValue: (row) => formatShortDate(row.authoredDateTime) },
  { key: "repository", header: "Repository", getValue: (row) => row.repository },
  { key: "branch", header: "Branch", getValue: (row) => row.branch },
  { key: "scanBranch", header: "Scan Branch", getValue: (row) => row.scanBranch },
  { key: "sha", header: "SHA", getValue: (row) => row.sha },
  { key: "message", header: "Message", getValue: (row) => row.message },
  { key: "wip", header: "WIP", getValue: (row) => (row.isWip ? "WIP" : "No") },
  { key: "merge", header: "Merge", getValue: (row) => (row.isMergeCommit ? "Merge" : "No") },
  { key: "mergeAuthor", header: "Author", getValue: formatAuthorExportValue },
];

let lastFilteredRows: DashboardCommitRow[] = [];

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replaceAll('"', '""') + '"';
  }

  return value;
}

function exportFilteredCommitsToCsv(): void {
  const hiddenColumns = new Set(
    columnControls
      .filter((control) => !control.checked)
      .map((control) => control.getAttribute("data-column-toggle")),
  );
  const columns = exportColumns.filter((column) => !hiddenColumns.has(column.key));
  if (columns.length === 0 || lastFilteredRows.length === 0) {
    return;
  }

  const lines = [columns.map((column) => csvEscape(column.header)).join(",")];
  for (const row of lastFilteredRows) {
    lines.push(columns.map((column) => csvEscape(column.getValue(row))).join(","));
  }

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.href = url;
  link.download = `gh-work-log-commits-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function linkedTask(row: DashboardCommitRow): { key: string; task: DashboardWorkTask | undefined } | null {
  const key = row.workLink?.task;
  if (!key) {
    return null;
  }
  return { key, task: DASHBOARD_DATA.workTasks?.[key] };
}

function taskSearchText(row: DashboardCommitRow): string {
  const linked = linkedTask(row);
  return linked ? linked.key + " " + (linked.task?.title ?? "") : "";
}

function renderTaskChip(row: DashboardCommitRow): string {
  const linked = linkedTask(row);
  if (!linked) {
    return "";
  }
  const number = linked.key.slice(linked.key.lastIndexOf("#"));
  const title = linked.key + (linked.task ? " - " + linked.task.title + (linked.task.status ? " (" + linked.task.status + ")" : "") : "");
  const label = escapeBrowserHtml(number);
  return linked.task
    ? ' <a class="task-chip" href="' + escapeBrowserHtml(linked.task.url) + '" target="_blank" rel="noreferrer noopener" title="' + escapeBrowserHtml(title) + '">' + label + '</a>'
    : ' <span class="task-chip" title="' + escapeBrowserHtml(title) + '">' + label + '</span>';
}

function escapeBrowserHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compareRows(left: DashboardCommitRow, right: DashboardCommitRow): number {
  let result = 0;

  if (sortState.key === "author") {
    result =
      resolveAuthorLabel(left).localeCompare(resolveAuthorLabel(right)) ||
      left.authoredDateTime.localeCompare(right.authoredDateTime) ||
      left.repository.localeCompare(right.repository) ||
      left.sha.localeCompare(right.sha);
  } else if (sortState.key === "repository") {
    result =
      left.repository.localeCompare(right.repository) ||
      left.authoredDateTime.localeCompare(right.authoredDateTime) ||
      left.sha.localeCompare(right.sha);
  } else {
    result =
      left.authoredDateTime.localeCompare(right.authoredDateTime) ||
      left.repository.localeCompare(right.repository) ||
      left.sha.localeCompare(right.sha);
  }

  return sortState.direction === "asc" ? result : -result;
}

function applyColumnVisibility(): void {
  const hiddenColumns = new Set(
    columnControls
      .filter((control) => !control.checked)
      .map((control) => control.getAttribute("data-column-toggle")),
  );

  const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-column]"));
  for (const cell of cells) {
    const column = cell.getAttribute("data-column");
    cell.style.display = hiddenColumns.has(column) ? "none" : "";
  }
}

function updateSortIndicators(): void {
  const indicators = Array.from(document.querySelectorAll<HTMLElement>("[data-sort-indicator]"));
  for (const indicator of indicators) {
    const key = indicator.getAttribute("data-sort-indicator");
    if (key !== sortState.key) {
      indicator.textContent = "";
      continue;
    }

    indicator.textContent = sortState.direction === "asc" ? "▲" : "▼";
  }
}

function renderRows(): void {
  const repoValue = repoFilter.value;
  const branchValue = branchFilter.value;
  const authorValue = authorFilter.value;
  const wipValue = wipFilter.value;
  const mergeValue = mergeFilter.value;
  const externalAuthorValue = externalAuthorFilter.value;
  const query = searchInput.value.trim().toLowerCase();

  const filtered = rows.filter((row) => {
    if (repoValue && row.repository !== repoValue) {
      return false;
    }
    if (branchValue && row.branch !== branchValue) {
      return false;
    }
    if (authorValue && authorFilterKey(resolveAuthor(row)) !== authorValue) {
      return false;
    }
    if (wipValue && String(row.isWip) !== wipValue) {
      return false;
    }
    if (mergeValue && String(row.isMergeCommit) !== mergeValue) {
      return false;
    }
    if (externalAuthorValue && String(row.mergeIncludesExternalAuthor) !== externalAuthorValue) {
      return false;
    }
    if (!query) {
      return true;
    }

    const haystack = [
      row.repository,
      row.branch,
      row.scanBranch,
      row.sha,
      row.message,
      resolveAuthorLabel(row),
      taskSearchText(row),
    ].join(" ").toLowerCase();
    return haystack.includes(query);
  }).sort(compareRows);

  lastFilteredRows = filtered;
  exportButton.disabled = filtered.length === 0;

  tableBody.innerHTML = filtered.map((row, index) => {
    const shortSha = row.sha.slice(0, 8);
    const badge = row.isWip
      ? '<span class="chip" style="border-color: rgba(171,35,70,.18); color: #ab2346;">WIP</span>'
      : '<span class="chip">No</span>';
    const mergeBadge = row.isMergeCommit
      ? '<span class="chip" style="border-color: rgba(18,116,117,.18); color: #127475;">Merge</span>'
      : '<span class="chip">No</span>';
    const author = resolveAuthor(row);
    const mergeAuthorBadge = author.source === "commit-name"
      ? '<span class="chip" title="Unverified name from Git commit metadata">' + escapeBrowserHtml(author.value) + '</span><span class="chip">Unverified</span>'
      : '<span class="chip"' + (row.mergeIncludesExternalAuthor ? ' style="border-color: rgba(214,108,6,.25); color: #d96c06;"' : '') + '>' + escapeBrowserHtml(author.value) + '</span>';

    const lines = row.message.trim().split("\n");
    const subject = lines[0] ?? "";
    const body = lines.slice(1).join("\n").trim();

    const expandBtn = body
      ? ' <button type="button" class="commit-expand-btn" data-toggle-subrow="' + index + '" title="Toggle full description">&hellip;</button>'
      : '';

    const taskChip = renderTaskChip(row);

    const mainRow = '<tr class="commit-row">' +
      '<td data-column="authored">' + escapeBrowserHtml(formatShortDate(row.authoredDateTime)) + '</td>' +
      '<td data-column="repository">' + formatRepoName(row.repository) + '</td>' +
      '<td data-column="branch">' + escapeBrowserHtml(row.branch) + '</td>' +
      '<td data-column="scanBranch">' + escapeBrowserHtml(row.scanBranch) + '</td>' +
      '<td data-column="sha"><a class="sha-link" href="' + escapeBrowserHtml(row.url) + '" target="_blank" rel="noreferrer noopener"><code>' + escapeBrowserHtml(shortSha) + '</code></a></td>' +
      '<td data-column="message"><div class="commit-msg-cell"><span class="commit-subject">' + escapeBrowserHtml(subject) + '</span>' + taskChip + expandBtn + '</div></td>' +
      '<td data-column="wip">' + badge + '</td>' +
      '<td data-column="merge">' + mergeBadge + '</td>' +
      '<td data-column="mergeAuthor">' + mergeAuthorBadge + '</td>' +
    '</tr>';

    const branchLabel = row.branch === row.scanBranch
      ? row.branch
      : row.branch + ' (scanned ' + row.scanBranch + ')';

    const detailRow = body
      ? '<tr class="commit-detail-row" id="detail-row-' + index + '" style="display: none;">' +
          '<td colspan="9" class="commit-detail-cell">' +
            '<div class="commit-detail-bar">' +
              '<div class="commit-detail-meta">' +
                '<span class="commit-detail-sha"><code>' + escapeBrowserHtml(shortSha) + '</code></span>' +
                '<span class="commit-detail-branch">' + escapeBrowserHtml(branchLabel) + '</span>' +
                mergeAuthorBadge +
                (row.isWip ? '<span class="chip" style="border-color: rgba(171,35,70,.18); color: #ab2346;">WIP</span>' : '') +
                (row.isMergeCommit ? '<span class="chip" style="border-color: rgba(18,116,117,.18); color: #127475;">Merge</span>' : '') +
              '</div>' +
              '<a class="commit-detail-link" href="' + escapeBrowserHtml(row.url) + '" target="_blank" rel="noreferrer noopener">View on GitHub &nearr;</a>' +
            '</div>' +
            '<pre class="commit-body">' + escapeBrowserHtml(body) + '</pre>' +
          '</td>' +
        '</tr>'
      : '';

    return mainRow + detailRow;
  }).join("");

  const filteredCount = filtered.length;
  const totalCount = rows.length;
  const summary = filteredCount === totalCount
    ? filteredCount + ' commits shown'
    : filteredCount + ' of ' + totalCount + ' commits shown';
  resultsMeta.textContent = summary;
  countChip.textContent = filteredCount.toLocaleString() + ' rows';

  const hasActiveFilter = Boolean(
    repoValue ||
    branchValue ||
    authorValue ||
    wipValue ||
    mergeValue ||
    externalAuthorValue ||
    query,
  );
  if (resetFiltersButton) {
    resetFiltersButton.style.display = hasActiveFilter ? "" : "none";
  }

  if (toggleAllButton) {
    toggleAllButton.textContent = "Expand All";
    toggleAllButton.disabled = filtered.length === 0;
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="9"><div class="empty">No commits match the current filters.</div></td></tr>';
  }

  applyColumnVisibility();
  updateSortIndicators();
}

function applyTheme(theme: Theme): void {
  document.body.setAttribute("data-theme", theme);
  if (themeToggle) {
    themeToggle.textContent = theme === "dark" ? "Light Theme" : "Dark Theme";
  }
}

function loadTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "dark" || saved === "light") {
      return saved;
    }
  } catch {
    // Ignore storage access errors (e.g. disabled in a private window).
  }

  return "light";
}

function persistTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Ignore storage access errors (e.g. disabled in a private window).
  }
}

repoFilter.addEventListener("change", renderRows);
branchFilter.addEventListener("change", renderRows);
authorFilter.addEventListener("change", renderRows);
wipFilter.addEventListener("change", renderRows);
mergeFilter.addEventListener("change", renderRows);
externalAuthorFilter.addEventListener("change", renderRows);
searchInput.addEventListener("input", renderRows);
exportButton.addEventListener("click", exportFilteredCommitsToCsv);

if (resetFiltersButton) {
  resetFiltersButton.addEventListener("click", () => {
    searchInput.value = "";
    repoFilter.value = "";
    branchFilter.value = "";
    authorFilter.value = "";
    wipFilter.value = "";
    mergeFilter.value = "";
    externalAuthorFilter.value = "";
    renderRows();
  });
}

if (toggleAllButton) {
  toggleAllButton.addEventListener("click", () => {
    const detailRows = Array.from(document.querySelectorAll<HTMLElement>(".commit-detail-row"));
    const expandButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-toggle-subrow]"));
    const parentRows = Array.from(document.querySelectorAll<HTMLElement>("tr.commit-row"));
    const isExpanding = toggleAllButton.textContent === "Expand All";

    for (const detailRow of detailRows) {
      detailRow.style.display = isExpanding ? "" : "none";
    }
    for (const button of expandButtons) {
      button.classList.toggle("is-active", isExpanding);
    }
    for (const parentRow of parentRows) {
      parentRow.classList.toggle("has-open-detail", isExpanding);
    }
    toggleAllButton.textContent = isExpanding ? "Collapse All" : "Expand All";
  });
}

tableBody.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-toggle-subrow]");
  if (!button) {
    return;
  }
  const index = button.getAttribute("data-toggle-subrow");
  if (!index) {
    return;
  }
  const detailRow = document.getElementById("detail-row-" + index);
  if (!detailRow) {
    return;
  }
  const isOpen = detailRow.style.display !== "none";
  detailRow.style.display = isOpen ? "none" : "";
  button.classList.toggle("is-active", !isOpen);
  const parentRow = button.closest("tr");
  if (parentRow) {
    parentRow.classList.toggle("has-open-detail", !isOpen);
  }
});

const tabToHash: Record<string, string> = {
  "overview-panel": "overview",
  "activity-panel": "activity",
  "contributors-panel": "contributors",
  "repositories-panel": "repositories",
  "issues-panel": "issues",
  "commits-panel": "commits",
};

const hashToTab: Record<string, string> = {
  overview: "overview-panel",
  activity: "activity-panel",
  contributors: "contributors-panel",
  repositories: "repositories-panel",
  issues: "issues-panel",
  commits: "commits-panel",
};

function activateTab(panelId: string, updateHash = true): void {
  for (const currentButton of tabButtons) {
    currentButton.classList.toggle("is-active", currentButton.getAttribute("data-tab") === panelId);
  }
  for (const panel of tabPanels) {
    panel.classList.toggle("is-active", panel.id === panelId);
  }
  if (updateHash && tabToHash[panelId]) {
    window.location.hash = tabToHash[panelId];
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const target = button.getAttribute("data-tab");
    if (target) {
      activateTab(target, true);
    }
  });
}

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash && hashToTab[hash]) {
    activateTab(hashToTab[hash], false);
  }
});

function setHeroCompact(compact: boolean, persist = true): void {
  if (heroContainer && heroCompactBar) {
    heroContainer.style.display = compact ? "none" : "";
    heroCompactBar.style.display = compact ? "" : "none";
  }
  if (heroToggle) {
    heroToggle.textContent = compact ? "Full Header" : "Compact Header";
  }
  if (persist) {
    try {
      window.localStorage.setItem(heroCompactStorageKey, compact ? "true" : "false");
    } catch {
      // Ignore storage errors
    }
  }
}

if (heroToggle) {
  heroToggle.addEventListener("click", () => {
    const isCurrentlyCompact = heroCompactBar ? heroCompactBar.style.display !== "none" : false;
    setHeroCompact(!isCurrentlyCompact);
  });
}

if (heroExpandBtn) {
  heroExpandBtn.addEventListener("click", () => {
    setHeroCompact(false);
  });
}

function loadHeroPreference(): void {
  try {
    const saved = window.localStorage.getItem(heroCompactStorageKey);
    if (saved === "true") {
      setHeroCompact(true, false);
    }
  } catch {
    // Ignore storage errors
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target) {
    return;
  }

  const repoLink = target.closest<HTMLElement>("[data-drilldown-repo]");
  if (repoLink) {
    event.preventDefault();
    const repo = repoLink.getAttribute("data-drilldown-repo");
    if (repo) {
      activateTab("commits-panel", true);
      repoFilter.value = repo;
      renderRows();
      document.getElementById("commits-panel")?.scrollIntoView({ behavior: "smooth" });
    }
    return;
  }

  const catLink = target.closest<HTMLElement>("[data-drilldown-category]");
  if (catLink) {
    event.preventDefault();
    const cat = catLink.getAttribute("data-drilldown-category");
    if (cat) {
      activateTab("commits-panel", true);
      searchInput.value = cat + ":";
      renderRows();
      document.getElementById("commits-panel")?.scrollIntoView({ behavior: "smooth" });
    }
    return;
  }
});

document.addEventListener("mouseover", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target || !chartTooltip) {
    return;
  }
  const point = target.closest<SVGCircleElement>(".chart-point");
  if (!point) {
    chartTooltip.style.display = "none";
    return;
  }

  const label = point.getAttribute("data-chart-label");
  const value = point.getAttribute("data-chart-value");
  if (label && value !== null) {
    chartTooltip.textContent = `${label}: ${Number(value).toLocaleString()} commits`;
    chartTooltip.style.display = "block";
    const rect = point.getBoundingClientRect();
    chartTooltip.style.left = `${rect.left + rect.width / 2}px`;
    chartTooltip.style.top = `${rect.top}px`;
  }
});

document.addEventListener("mouseout", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(".chart-point") && chartTooltip) {
    chartTooltip.style.display = "none";
  }
});

interface RepoSortState {
  key: string;
  direction: SortDirection;
}

const repoSortState: RepoSortState = {
  key: "commitCount",
  direction: "desc",
};

const repoRows = (DASHBOARD_DATA.perRepository || []).slice();
const contributorRows = (DASHBOARD_DATA.contributors || []).slice();
const contributorSearch = document.getElementById("contributor-search") as HTMLInputElement | null;
const contributorTableBody = document.getElementById("contributor-table-body");
const contributorSortHeaders = Array.from(
  document.querySelectorAll<HTMLElement>("[data-contributor-sort-key]"),
);
const contributorSortState: SortState = {
  key: "commitCount",
  direction: "desc",
};

function renderContributorSummary(): void {
  if (!contributorTableBody) {
    return;
  }

  const query = contributorSearch?.value.trim().toLowerCase() || "";
  const filtered = contributorRows.filter((contributor) =>
    !query || (contributor.login ?? "unknown").toLowerCase().includes(query),
  );

  filtered.sort((left, right) => {
    if (contributorSortState.key === "login") {
      if (left.login === null || right.login === null) {
        return left.login === right.login ? 0 : left.login === null ? 1 : -1;
      }
      const result = left.login.localeCompare(right.login);
      return contributorSortState.direction === "asc" ? result : -result;
    }

    const key = contributorSortState.key as "commitCount" | "repositoryCount" | "additions" | "deletions";
    const result = (left[key] ?? 0) - (right[key] ?? 0);
    return contributorSortState.direction === "asc" ? result : -result;
  });

  const includeDiffStats = contributorRows.some(
    (contributor) => contributor.additions !== undefined,
  );
  contributorTableBody.innerHTML = filtered.map((contributor) =>
    `<tr>
      <td>${escapeBrowserHtml(contributor.login ?? "Unknown")}</td>
      <td>${contributor.commitCount.toLocaleString()}</td>
      <td>${contributor.repositoryCount.toLocaleString()}</td>
      ${includeDiffStats ? `<td>${(contributor.additions ?? 0).toLocaleString()}</td><td>${(contributor.deletions ?? 0).toLocaleString()}</td>` : ""}
    </tr>`,
  ).join("");

  for (const header of contributorSortHeaders) {
    const indicator = header.querySelector<HTMLElement>("[data-contributor-sort-indicator]");
    if (indicator) {
      const key = header.getAttribute("data-contributor-sort-key");
      indicator.textContent =
        key === contributorSortState.key
          ? contributorSortState.direction === "asc"
            ? "▲"
            : "▼"
          : "";
    }
  }
}

if (contributorSearch) {
  contributorSearch.addEventListener("input", renderContributorSummary);
}

for (const header of contributorSortHeaders) {
  header.addEventListener("click", () => {
    const key = header.getAttribute("data-contributor-sort-key");
    if (!key) {
      return;
    }
    if (contributorSortState.key === key) {
      contributorSortState.direction =
        contributorSortState.direction === "asc" ? "desc" : "asc";
    } else {
      contributorSortState.key = key;
      contributorSortState.direction = key === "login" ? "asc" : "desc";
    }
    renderContributorSummary();
  });
}

function renderRepoSummary(): void {
  if (!repoSummaryTbody) {
    return;
  }

  const query = repoSummarySearch?.value.trim().toLowerCase() || "";
  const filtered = repoRows.filter((r) => !query || r.repository.toLowerCase().includes(query));

  filtered.sort((a, b) => {
    let result = 0;
    if (repoSortState.key === "commitCount") {
      result = a.commitCount - b.commitCount;
    } else if (repoSortState.key === "firstCommitAt") {
      result = a.firstCommitAt.localeCompare(b.firstCommitAt);
    } else if (repoSortState.key === "lastCommitAt") {
      result = a.lastCommitAt.localeCompare(b.lastCommitAt);
    } else {
      result = a.repository.localeCompare(b.repository);
    }
    return repoSortState.direction === "asc" ? result : -result;
  });

  const max = Math.max(...repoRows.map((r) => r.commitCount), 1);
  repoSummaryTbody.innerHTML = filtered
    .map((repo) => {
      const width = Math.max((repo.commitCount / max) * 100, 2);
      return `<tr data-repo-name="${escapeBrowserHtml(repo.repository.toLowerCase())}">
      <td>
        <a href="#commits" class="drilldown-link" data-drilldown-repo="${escapeBrowserHtml(repo.repository)}" title="Filter commits for ${escapeBrowserHtml(repo.repository)}">${escapeBrowserHtml(repo.repository)}</a>
        <a href="https://github.com/${escapeBrowserHtml(repo.repository)}" target="_blank" rel="noreferrer noopener" class="external-repo-link" title="Open repository on GitHub">&nearr;</a>
      </td>
      <td>
        <div class="repo-volume-cell">
          <span class="repo-volume-num">${repo.commitCount.toLocaleString()}</span>
          <div class="bar-track repo-volume-track"><div class="bar-fill" style="width: ${width}%;"></div></div>
        </div>
      </td>
      <td>${formatShortDate(repo.firstCommitAt)}</td>
      <td>${formatShortDate(repo.lastCommitAt)}</td>
    </tr>`;
    })
    .join("");

  for (const header of repoSortHeaders) {
    const indicator = header.querySelector<HTMLElement>("[data-repo-sort-indicator]");
    if (indicator) {
      const key = header.getAttribute("data-repo-sort-key");
      indicator.textContent = key === repoSortState.key ? (repoSortState.direction === "asc" ? "▲" : "▼") : "";
    }
  }
}

if (repoSummarySearch) {
  repoSummarySearch.addEventListener("input", renderRepoSummary);
}

for (const header of repoSortHeaders) {
  header.addEventListener("click", () => {
    const key = header.getAttribute("data-repo-sort-key");
    if (!key) return;

    if (repoSortState.key === key) {
      repoSortState.direction = repoSortState.direction === "asc" ? "desc" : "asc";
    } else {
      repoSortState.key = key;
      repoSortState.direction = key === "repository" ? "asc" : "desc";
    }
    renderRepoSummary();
  });
}

if (copySummaryButton) {
  copySummaryButton.addEventListener("click", async () => {
    const summary = DASHBOARD_DATA.summary;
    const meta = DASHBOARD_DATA.metadata;
    const highlights = DASHBOARD_DATA.highlights;

    if (!summary || !meta) {
      return;
    }

    const topRepos = (highlights?.topRepositories || [])
      .slice(0, 5)
      .map((r) => `- \`${r.repository}\`: ${r.commitCount.toLocaleString()} commits`)
      .join("\n");

    const text = [
      `### GitHub Work Log Summary (${formatShortDate(meta.since).slice(0, 10)} to ${formatShortDate(meta.until).slice(0, 10)})`,
      `**${meta.reportMode === "organization" ? "Report scope" : "Target Author"}**: ${meta.reportMode === "organization" ? "All observed contributors" : meta.targetAuthor} | **Authenticated User**: ${meta.authenticatedUser}`,
      `**Total Commits**: ${summary.uniqueCommits.toLocaleString()} unique across ${summary.repositoriesWithCommits} repositories (${summary.durationSeconds}s scan)`,
      "",
      "**Top Repositories**:",
      topRepos,
      highlights?.codeLevel
        ? `\n**Code Churn**: +${highlights.codeLevel.totalAdditions.toLocaleString()} / -${highlights.codeLevel.totalDeletions.toLocaleString()} lines across ${highlights.codeLevel.totalFilesChanged.toLocaleString()} files`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      const originalText = copySummaryButton.textContent;
      copySummaryButton.textContent = "Copied to Clipboard!";
      copySummaryButton.classList.add("is-success");
      setTimeout(() => {
        copySummaryButton.textContent = originalText;
        copySummaryButton.classList.remove("is-success");
      }, 2000);
    } catch {
      window.prompt("Copy work log summary:", text);
    }
  });
}

function loadColumnPreferences(): void {
  try {
    const saved = window.localStorage.getItem(columnsStorageKey);
    if (!saved) {
      return;
    }
    const visibleColumns = new Set(JSON.parse(saved) as string[]);
    for (const control of columnControls) {
      const col = control.getAttribute("data-column-toggle");
      if (col) {
        control.checked = visibleColumns.has(col);
      }
    }
  } catch {
    // Ignore storage access errors (e.g. disabled in a private window).
  }
}

function persistColumnPreferences(): void {
  try {
    const visibleColumns = columnControls
      .filter((control) => control.checked)
      .map((control) => control.getAttribute("data-column-toggle"))
      .filter((col): col is string => Boolean(col));
    window.localStorage.setItem(columnsStorageKey, JSON.stringify(visibleColumns));
  } catch {
    // Ignore storage access errors (e.g. disabled in a private window).
  }
}

for (const control of columnControls) {
  control.addEventListener("change", () => {
    applyColumnVisibility();
    persistColumnPreferences();
  });
}

for (const header of sortHeaders) {
  header.addEventListener("click", () => {
    const key = header.getAttribute("data-sort-key");
    if (!key) {
      return;
    }

    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
    } else {
      sortState.key = key;
      sortState.direction = key === "repository" ? "asc" : "desc";
    }

    renderRows();
  });
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const nextTheme = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    persistTheme(nextTheme);
  });
}

applyTheme(loadTheme());
loadHeroPreference();
loadColumnPreferences();
renderRows();
renderRepoSummary();
renderContributorSummary();

const initialHash = window.location.hash.replace(/^#/, "");
if (initialHash && hashToTab[initialHash]) {
  activateTab(hashToTab[initialHash], false);
}
