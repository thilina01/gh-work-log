import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readToolIdentity, warnIfDistAppearsStale } from "../../src/tool-identity";

describe("tool identity", () => {
  it("reads package name and version", () => {
    const identity = readToolIdentity();
    expect(identity.name).toBe("gh-work-log");
    expect(identity.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("warns when src is newer than dist/cli.js", () => {
    const root = mkdtempSync(path.join(tmpdir(), "gh-work-log-stale-"));
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.join(root, "dist"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "gh-work-log", version: "1.0.0" }));
    writeFileSync(path.join(root, "dist", "cli.js"), "console.log('old')\n");
    writeFileSync(path.join(root, "src", "cli.ts"), "export {}\n");

    const old = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-10-29T00:00:00.000Z");
    utimesSync(path.join(root, "dist", "cli.js"), old, old);
    utimesSync(path.join(root, "src", "cli.ts"), newer, newer);

    const messages: string[] = [];
    const warned = warnIfDistAppearsStale(root, (message) => messages.push(message));
    expect(warned).toBe(true);
    expect(messages[0]).toContain("dist/ appears stale");
  });
});
