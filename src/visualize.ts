#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHtmlReport } from "./visualizer/render";
import { RunResult } from "./types";

interface VisualizeOptions {
  input?: string;
  output?: string;
  help: boolean;
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${renderHelp()}\n`);
      return;
    }

    if (!options.input) {
      throw new Error("`--input` is required.");
    }

    const inputPath = path.resolve(options.input);
    const outputPath = path.resolve(options.output ?? replaceExtension(inputPath, ".html"));
    const report = parseReport(await readFile(inputPath, "utf8"));
    const html = renderHtmlReport(report);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html, "utf8");

    process.stdout.write(`Wrote HTML report to ${outputPath}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): VisualizeOptions {
  const options: VisualizeOptions = {
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "--help") {
      options.help = true;
      continue;
    }

    const [flag, inlineValue] = splitToken(token);
    const value = inlineValue ?? argv[index + 1];

    if (flag === "--input") {
      if (!value || value.startsWith("--")) {
        throw new Error("`--input` requires a value.");
      }
      options.input = value;
      index += inlineValue === undefined ? 1 : 0;
      continue;
    }

    if (flag === "--output") {
      if (!value || value.startsWith("--")) {
        throw new Error("`--output` requires a value.");
      }
      options.output = value;
      index += inlineValue === undefined ? 1 : 0;
      continue;
    }

    throw new Error(`Unknown flag "${flag}".`);
  }

  return options;
}

function splitToken(token: string): [string, string | undefined] {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex === -1) {
    return [token, undefined];
  }

  return [token.slice(0, separatorIndex), token.slice(separatorIndex + 1)];
}

function renderHelp(): string {
  return [
    "Usage: npm run visualize -- --input <report.json> [--output <report.html>]",
    "",
    "Options:",
    "  --input     Path to the generated JSON report",
    "  --output    Destination HTML path",
    "  --help      Show this help text",
  ].join("\n");
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function parseReport(value: string): RunResult {
  const parsed = JSON.parse(value) as Partial<RunResult>;

  if (!parsed.metadata || !parsed.statistics || !parsed.failures || !parsed.data) {
    throw new Error("Input does not match the expected report shape.");
  }

  return parsed as RunResult;
}

void main();
