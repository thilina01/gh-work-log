import { safeJson } from "./helpers";

export function renderBrowserScript(dashboardData: unknown): string {
  return `
      const DASHBOARD_DATA = ${safeJson(dashboardData)};
      const rows = DASHBOARD_DATA.commits.slice().sort((a, b) =>
        b.authoredDateTime.localeCompare(a.authoredDateTime) ||
        a.repository.localeCompare(b.repository) ||
        a.sha.localeCompare(b.sha)
      );
      const repoFilter = document.getElementById("repo-filter");
      const branchFilter = document.getElementById("branch-filter");
      const authorFilter = document.getElementById("author-filter");
      const wipFilter = document.getElementById("wip-filter");
      const mergeFilter = document.getElementById("merge-filter");
      const externalAuthorFilter = document.getElementById("external-author-filter");
      const searchInput = document.getElementById("commit-search");
      const tableBody = document.getElementById("commit-table-body");
      const resultsMeta = document.getElementById("commit-results-meta");
      const countChip = document.getElementById("commit-count-chip");
      const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
      const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
      const columnControls = Array.from(document.querySelectorAll("[data-column-toggle]"));
      const sortHeaders = Array.from(document.querySelectorAll("[data-sort-key]"));
      const themeToggle = document.getElementById("theme-toggle");
      const storageKey = "gh-work-log-theme";
      let sortState = {
        key: "authoredDateTime",
        direction: "desc"
      };

      const repositories = Array.from(new Set(rows.map((row) => row.repository))).sort();
      const branches = Array.from(new Set(rows.map((row) => row.branch))).sort();
      const authors = Array.from(new Set(rows.map((row) => resolveAuthorLabel(row)).filter(Boolean))).sort();

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

      for (const author of authors) {
        const option = document.createElement("option");
        option.value = author;
        option.textContent = author;
        authorFilter.appendChild(option);
      }

      function resolveAuthorLabel(row) {
        if (row.isMergeCommit && row.mergeBranchAuthorLogin) {
          return row.mergeBranchAuthorLogin;
        }

        return row.authorLogin || row.authorEmail || null;
      }

      function renderRows() {
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
          if (authorValue && resolveAuthorLabel(row) !== authorValue) {
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
          ].join(" ").toLowerCase();
          return haystack.includes(query);
        }).sort(compareRows);

        tableBody.innerHTML = filtered.map((row) => {
          const shortSha = row.sha.slice(0, 8);
          const badge = row.isWip
            ? '<span class="chip" style="border-color: rgba(171,35,70,.18); color: #ab2346;">WIP</span>'
            : '<span class="chip">No</span>';
          const mergeBadge = row.isMergeCommit
            ? '<span class="chip" style="border-color: rgba(18,116,117,.18); color: #127475;">Merge</span>'
            : '<span class="chip">No</span>';
          const authorLabel = resolveAuthorLabel(row);
          const mergeAuthorBadge = authorLabel
            ? '<span class="chip"' + (row.mergeIncludesExternalAuthor ? ' style="border-color: rgba(214,108,6,.25); color: #d96c06;"' : '') + '>' + escapeBrowserHtml(authorLabel) + '</span>'
            : '<span class="chip">&mdash;</span>';

          return '<tr>' +
            '<td data-column="authored">' + formatBrowserHtml(new Date(row.authoredDateTime).toLocaleString()) + '</td>' +
            '<td data-column="repository">' + escapeBrowserHtml(row.repository) + '</td>' +
            '<td data-column="branch">' + escapeBrowserHtml(row.branch) + '</td>' +
            '<td data-column="scanBranch">' + escapeBrowserHtml(row.scanBranch) + '</td>' +
            '<td data-column="sha"><a class="sha-link" href="' + escapeBrowserHtml(row.url) + '" target="_blank" rel="noreferrer noopener"><code>' + escapeBrowserHtml(shortSha) + '</code></a></td>' +
            '<td data-column="message">' + escapeBrowserHtml(row.message) + '</td>' +
            '<td data-column="wip">' + badge + '</td>' +
            '<td data-column="merge">' + mergeBadge + '</td>' +
            '<td data-column="mergeAuthor">' + mergeAuthorBadge + '</td>' +
          '</tr>';
        }).join("");

        const filteredCount = filtered.length;
        const totalCount = rows.length;
        const summary = filteredCount === totalCount
          ? filteredCount + ' commits shown'
          : filteredCount + ' of ' + totalCount + ' commits shown';
        resultsMeta.textContent = summary;
        countChip.textContent = filteredCount.toLocaleString() + ' rows';

        if (filtered.length === 0) {
          tableBody.innerHTML = '<tr><td colspan="9"><div class="empty">No commits match the current filters.</div></td></tr>';
        }

        applyColumnVisibility();
        updateSortIndicators();
      }

      function escapeBrowserHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatBrowserHtml(value) {
        return escapeBrowserHtml(value);
      }

      function applyColumnVisibility() {
        const hiddenColumns = new Set(
          columnControls
            .filter((control) => !control.checked)
            .map((control) => control.getAttribute("data-column-toggle"))
        );

        const cells = Array.from(document.querySelectorAll("[data-column]"));
        for (const cell of cells) {
          const column = cell.getAttribute("data-column");
          cell.style.display = hiddenColumns.has(column) ? "none" : "";
        }
      }

      function compareRows(left, right) {
        let result = 0;

        if (sortState.key === "repository") {
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

      function updateSortIndicators() {
        const indicators = Array.from(document.querySelectorAll("[data-sort-indicator]"));
        for (const indicator of indicators) {
          const key = indicator.getAttribute("data-sort-indicator");
          if (key !== sortState.key) {
            indicator.textContent = "";
            continue;
          }

          indicator.textContent = sortState.direction === "asc" ? "▲" : "▼";
        }
      }

      function applyTheme(theme) {
        document.body.setAttribute("data-theme", theme);
        if (themeToggle) {
          themeToggle.textContent = theme === "dark" ? "Light Theme" : "Dark Theme";
        }
      }

      function loadTheme() {
        try {
          const saved = window.localStorage.getItem(storageKey);
          if (saved === "dark" || saved === "light") {
            return saved;
          }
        } catch (_error) {
        }

        return "light";
      }

      function persistTheme(theme) {
        try {
          window.localStorage.setItem(storageKey, theme);
        } catch (_error) {
        }
      }

      repoFilter.addEventListener("change", renderRows);
      branchFilter.addEventListener("change", renderRows);
      authorFilter.addEventListener("change", renderRows);
      wipFilter.addEventListener("change", renderRows);
      mergeFilter.addEventListener("change", renderRows);
      externalAuthorFilter.addEventListener("change", renderRows);
      searchInput.addEventListener("input", renderRows);

      for (const button of tabButtons) {
        button.addEventListener("click", () => {
          const target = button.getAttribute("data-tab");
          for (const currentButton of tabButtons) {
            currentButton.classList.toggle("is-active", currentButton === button);
          }
          for (const panel of tabPanels) {
            panel.classList.toggle("is-active", panel.id === target);
          }
        });
      }

      for (const control of columnControls) {
        control.addEventListener("change", applyColumnVisibility);
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
      renderRows();
`;
}
