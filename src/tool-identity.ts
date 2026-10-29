import fs from "node:fs";
import path from "node:path";
import { ToolIdentity } from "./types";

const PACKAGE_NAME = "gh-work-log";

export function resolvePackageRoot(
  startDir: string = path.dirname(__filename),
): string {
  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, "package.json");
    if (fs.existsSync(candidate)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate package.json from the running CLI.");
    }
    current = parent;
  }
}

export function readToolIdentity(packageRoot: string = resolvePackageRoot()): ToolIdentity {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { name?: string; version?: string };
  return {
    name: parsed.name?.trim() || PACKAGE_NAME,
    packageVersion: parsed.version?.trim() || "0.0.0",
  };
}

/**
 * Warn when a local TypeScript checkout looks newer than the built CLI.
 * Never throws; callers decide whether to stop (e.g. profile REFRESH.md).
 */
export function warnIfDistAppearsStale(
  packageRoot: string = resolvePackageRoot(),
  write: (message: string) => void = (message) => {
    process.stderr.write(`${message}\n`);
  },
): boolean {
  const srcDir = path.join(packageRoot, "src");
  const distCli = path.join(packageRoot, "dist", "cli.js");
  if (!fs.existsSync(srcDir) || !fs.existsSync(distCli)) {
    return false;
  }

  const newestSrcMs = newestTypescriptMtimeMs(srcDir);
  const distMs = fs.statSync(distCli).mtimeMs;
  if (newestSrcMs <= distMs) {
    return false;
  }

  write(
    "Warning: gh-work-log dist/ appears stale relative to src/. Run `npm run build` before relying on this CLI.",
  );
  return true;
}

function newestTypescriptMtimeMs(dir: string): number {
  let newest = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestTypescriptMtimeMs(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      newest = Math.max(newest, fs.statSync(fullPath).mtimeMs);
    }
  }
  return newest;
}
