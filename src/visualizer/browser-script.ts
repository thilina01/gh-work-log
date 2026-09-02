import { readFileSync } from "node:fs";
import path from "node:path";
import { safeJson } from "./helpers";

const BROWSER_CLIENT_PATH = path.join(__dirname, "browser-client.js");
let cachedBrowserClientSource: string | undefined;

function readBrowserClientSource(): string {
  cachedBrowserClientSource ??= readFileSync(BROWSER_CLIENT_PATH, "utf8");
  return cachedBrowserClientSource;
}

export function renderBrowserScript(dashboardData: unknown): string {
  return `const DASHBOARD_DATA = ${safeJson(dashboardData)};\n${readBrowserClientSource()}`;
}
