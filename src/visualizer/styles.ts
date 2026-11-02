export const VISUALIZER_STYLES = `
      :root {
        --bg: #f4efe6;
        --panel: rgba(255, 252, 247, 0.84);
        --panel-strong: rgba(255, 249, 241, 0.95);
        --ink: #14213d;
        --muted: #5f6b7a;
        --line: rgba(20, 33, 61, 0.12);
        --accent: #d96c06;
        --accent-soft: rgba(217, 108, 6, 0.12);
        --teal: #127475;
        --rose: #ab2346;
        --shadow: 0 18px 50px rgba(20, 33, 61, 0.08);
      }

      body[data-theme="dark"] {
        --bg: #10161f;
        --panel: rgba(19, 28, 40, 0.9);
        --panel-strong: rgba(22, 33, 48, 0.96);
        --ink: #edf3ff;
        --muted: #9fb0c5;
        --line: rgba(190, 208, 234, 0.12);
        --accent: #ff9d2f;
        --accent-soft: rgba(255, 157, 47, 0.16);
        --teal: #57c7c4;
        --rose: #ff6b8f;
        --shadow: 0 18px 60px rgba(0, 0, 0, 0.32);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(18, 116, 117, 0.18), transparent 30%),
          radial-gradient(circle at top right, rgba(217, 108, 6, 0.16), transparent 34%),
          linear-gradient(180deg, #fbf7f0 0%, #f4efe6 48%, #ebe3d6 100%);
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
      }

      body[data-theme="dark"] {
        background:
          radial-gradient(circle at top left, rgba(87, 199, 196, 0.13), transparent 28%),
          radial-gradient(circle at top right, rgba(255, 157, 47, 0.12), transparent 32%),
          linear-gradient(180deg, #0d141d 0%, #111923 50%, #0a1017 100%);
      }

      .page {
        width: min(1680px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 56px;
      }

      .page-topbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 14px;
      }

      .hero {
        display: grid;
        grid-template-columns: 1.3fr 0.7fr;
        gap: 20px;
        margin-bottom: 24px;
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(20px);
      }

      .hero-main {
        padding: 28px 28px 24px;
      }

      .eyebrow {
        color: var(--accent);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1 {
        margin: 10px 0 14px;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        font-size: clamp(34px, 4vw, 54px);
        line-height: 0.96;
      }

      .lede {
        margin: 0;
        max-width: 68ch;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.6;
      }

      .meta-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 22px;
      }

      .meta-pill {
        padding: 12px 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.64);
        border: 1px solid var(--line);
      }

      body[data-theme="dark"] .meta-pill {
        background: rgba(237, 243, 255, 0.1);
        border-color: rgba(190, 208, 234, 0.18);
      }

      .meta-pill strong,
      .card-value,
      .section-title,
      th {
        letter-spacing: -0.02em;
      }

      .hero-side {
        padding: 24px;
        display: grid;
        gap: 12px;
        align-content: start;
      }

      .score {
        padding: 16px 18px;
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(255, 248, 236, 0.86));
        border: 1px solid var(--line);
      }

      body[data-theme="dark"] .score {
        background: linear-gradient(180deg, rgba(237, 243, 255, 0.1), rgba(237, 243, 255, 0.06));
        border-color: rgba(190, 208, 234, 0.18);
      }

      .score-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }

      .score strong {
        display: block;
        margin-top: 6px;
        font-size: 28px;
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 24px;
      }

      .card {
        padding: 18px;
      }

      .card-label {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .card-value {
        margin-top: 10px;
        font-size: 30px;
        font-weight: 750;
      }

      .card-hint {
        margin-top: 10px;
        color: var(--muted);
        font-size: 13px;
      }

      .tab-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 24px;
      }

      .tab-button {
        appearance: none;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        color: var(--ink);
        padding: 12px 16px;
        border-radius: 999px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, transform 120ms ease;
      }

      body[data-theme="dark"] .tab-button {
        background: rgba(237, 243, 255, 0.14);
        color: #edf3ff;
        border-color: rgba(190, 208, 234, 0.2);
      }

      .tab-button:hover {
        transform: translateY(-1px);
      }

      .tab-button.is-active {
        background: linear-gradient(90deg, var(--accent), #ffb44a);
        color: #fffaf3;
        border-color: transparent;
      }

      body[data-theme="dark"] .tab-button.is-active {
        color: #201208;
      }

      .tab-panel {
        display: none;
      }

      .tab-panel.is-active {
        display: block;
      }

      .stack {
        display: grid;
        gap: 20px;
      }

      .stack--wide {
        grid-template-columns: 1fr;
      }

      .section {
        padding: 22px;
      }

      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        margin-bottom: 18px;
      }

      .section-title {
        margin: 0;
        font-size: 22px;
      }

      .section-copy {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }

      .chart-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
      }

      .chart-stack {
        display: grid;
        gap: 16px;
      }

      .chart-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.58);
      }

      body[data-theme="dark"] .chart-card {
        background: rgba(237, 243, 255, 0.06);
        border-color: rgba(190, 208, 234, 0.16);
      }

      .chart-card--wide {
        padding: 18px;
      }

      .chart-card h3 {
        margin: 0 0 4px;
        font-size: 15px;
      }

      .chart-card p {
        margin: 0 0 14px;
        color: var(--muted);
        font-size: 13px;
      }

      .chart {
        width: 100%;
        height: auto;
        display: block;
      }

      .table-wrap {
        overflow: auto;
        border-radius: 18px;
        border: 1px solid var(--line);
      }

      .table-wrap--commits {
        max-height: 72vh;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(255, 255, 255, 0.62);
      }

      body[data-theme="dark"] table {
        background: rgba(237, 243, 255, 0.07);
      }

      th,
      td {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--line);
        font-size: 13px;
        vertical-align: top;
      }

      td[data-column="authored"] {
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        color: var(--muted);
      }

      td[data-column="repository"] {
        white-space: nowrap;
        font-weight: 500;
      }

      .repo-org {
        color: var(--muted);
        opacity: 0.65;
        font-weight: normal;
      }

      .repo-name {
        font-weight: 600;
      }

      td[data-column="branch"],
      td[data-column="scanBranch"],
      td[data-column="sha"],
      td[data-column="wip"],
      td[data-column="merge"],
      td[data-column="mergeAuthor"] {
        white-space: nowrap;
      }

      td[data-column="sha"] code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      td[data-column="message"] {
        width: 100%;
      }

      .commit-msg-cell {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .commit-subject {
        line-height: 1.45;
        word-break: break-word;
      }

      .commit-expand-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        height: 18px;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        border-radius: 6px;
        background: var(--accent-soft);
        color: var(--accent);
        border: 1px solid var(--line);
        cursor: pointer;
        flex-shrink: 0;
        transition: background 120ms ease, color 120ms ease;
      }

      .commit-expand-btn:hover,
      .commit-expand-btn.is-active {
        background: var(--accent);
        color: #fff;
      }

      tr.has-open-detail td {
        border-bottom-color: transparent;
      }

      .commit-detail-row {
        background: rgba(20, 33, 61, 0.02);
      }

      body[data-theme="dark"] .commit-detail-row {
        background: rgba(0, 0, 0, 0.22);
      }

      .commit-detail-row:hover {
        background: rgba(20, 33, 61, 0.02) !important;
      }

      body[data-theme="dark"] .commit-detail-row:hover {
        background: rgba(0, 0, 0, 0.22) !important;
      }

      .commit-detail-cell {
        padding: 4px 14px 12px !important;
        border-bottom: 1px solid var(--line) !important;
      }

      .commit-detail-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 12px;
      }

      .commit-detail-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .commit-detail-sha code {
        font-weight: 700;
        color: var(--teal);
        background: rgba(18, 116, 117, 0.12);
        padding: 2px 6px;
        border-radius: 4px;
      }

      body[data-theme="dark"] .commit-detail-sha code {
        background: rgba(87, 199, 196, 0.18);
      }

      .commit-detail-branch {
        padding: 2px 7px;
        border-radius: 4px;
        background: rgba(20, 33, 61, 0.06);
        border: 1px solid var(--line);
        font-size: 11px;
      }

      body[data-theme="dark"] .commit-detail-branch {
        background: rgba(237, 243, 255, 0.08);
      }

      .commit-detail-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--accent);
        text-decoration: none;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        padding: 3px 8px;
        border-radius: 6px;
        background: var(--accent-soft);
        border: 1px solid transparent;
        transition: background 120ms ease, color 120ms ease;
      }

      .commit-detail-link:hover {
        background: var(--accent);
        color: #fff;
      }

      .commit-body {
        margin: 0;
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(20, 33, 61, 0.05);
        border: 1px solid var(--line);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 320px;
        overflow-y: auto;
      }

      body[data-theme="dark"] .commit-body {
        background: rgba(10, 16, 24, 0.7);
        border-color: rgba(190, 208, 234, 0.14);
        color: #dbe4f0;
      }

      th {
        position: sticky;
        top: 0;
        z-index: 1;
        background: rgba(251, 247, 240, 0.98);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.11em;
        color: var(--muted);
      }

      body[data-theme="dark"] th {
        background: rgba(18, 27, 39, 0.96);
        color: #bed0ea;
      }

      .sortable {
        cursor: pointer;
        user-select: none;
      }

      .sortable-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .sort-indicator {
        font-size: 11px;
        color: var(--accent);
      }

      .sha-link {
        color: var(--teal);
        text-decoration: none;
        font-weight: 700;
      }

      .sha-link:hover {
        text-decoration: underline;
      }

      tbody tr:hover {
        background: rgba(18, 116, 117, 0.06);
      }

      body[data-theme="dark"] tbody tr:hover {
        background: rgba(87, 199, 196, 0.1);
      }

      .bar-list {
        display: grid;
        gap: 12px;
      }

      .bar-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
      }

      .bar-label {
        font-size: 14px;
        line-height: 1.4;
      }

      .bar-track {
        width: 100%;
        margin-top: 8px;
        height: 12px;
        border-radius: 999px;
        background: rgba(20, 33, 61, 0.08);
        overflow: hidden;
      }

      .bar-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent), #ffb44a);
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.7);
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      body[data-theme="dark"] .chip {
        background: rgba(237, 243, 255, 0.12);
        border-color: rgba(190, 208, 234, 0.18);
        color: #c7d6e8;
      }

      .filter-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 14px;
      }

      .filter-row input,
      .filter-row select {
        min-width: 190px;
        padding: 11px 12px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.85);
        color: var(--ink);
        font: inherit;
      }

      body[data-theme="dark"] .filter-row input,
      body[data-theme="dark"] .filter-row select {
        background: rgba(18, 27, 39, 0.92);
        border-color: rgba(190, 208, 234, 0.18);
        color: #edf3ff;
      }

      .column-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 0 0 14px;
      }

      .column-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.76);
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      body[data-theme="dark"] .column-toggle {
        background: rgba(237, 243, 255, 0.1);
        border-color: rgba(190, 208, 234, 0.18);
        color: #d5e2f3;
      }

      .column-toggle input {
        accent-color: var(--accent);
      }

      .theme-toggle {
        appearance: none;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.72);
        color: var(--ink);
        padding: 10px 14px;
        border-radius: 999px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
      }

      body[data-theme="dark"] .theme-toggle {
        background: rgba(22, 33, 48, 0.92);
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .export-button {
        appearance: none;
        border: 1px solid var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
        padding: 8px 14px;
        border-radius: 999px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        cursor: pointer;
      }

      .export-button:hover {
        background: var(--accent);
        color: #fff;
      }

      .export-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: var(--accent-soft);
        color: var(--accent);
      }

      .reset-filter-btn {
        appearance: none;
        border: 1px solid var(--rose);
        background: rgba(171, 35, 70, 0.08);
        color: var(--rose);
        padding: 9px 14px;
        border-radius: 14px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease;
      }

      .reset-filter-btn:hover {
        background: var(--rose);
        color: #fff;
      }

      .empty {
        padding: 16px;
        border-radius: 16px;
        background: rgba(171, 35, 70, 0.08);
        color: var(--rose);
        font-size: 14px;
      }

      .results-meta {
        color: var(--muted);
        font-size: 13px;
      }

      .footer-note {
        margin-top: 20px;
        color: var(--muted);
        font-size: 13px;
      }

      @media (max-width: 1100px) {
        .hero,
        .cards,
        .chart-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 720px) {
        .page {
          width: min(100vw - 20px, 1440px);
          padding-top: 18px;
        }

        .hero-main,
        .hero-side,
        .section,
        .card {
          padding: 18px;
        }

        .meta-grid {
          grid-template-columns: 1fr;
        }
      }
`;
