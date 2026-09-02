#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  loadLocalConfigFile,
  mergeCliOptions,
  normalizeConfig,
  parseCliArgs,
  renderHelp,
} from "./config";
import { runApp } from "./app";
import { renderHtmlReport } from "./visualizer/render";

async function main(): Promise<void> {
  try {
    const parsedOptions = parseCliArgs(process.argv.slice(2));

    if (parsedOptions.help) {
      process.stdout.write(`${renderHelp()}\n`);
      process.exitCode = 0;
      return;
    }

    const localConfig = loadLocalConfigFile();
    const options = mergeCliOptions(parsedOptions, localConfig);
    const config = normalizeConfig(options);
    const result = await runApp(config);

    if (options.html) {
      const htmlPath = replaceExtension(config.outputPath, ".html");
      await mkdir(path.dirname(htmlPath), { recursive: true });
      await writeFile(htmlPath, renderHtmlReport(result), "utf8");
      process.stdout.write(`Wrote HTML report to ${htmlPath}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message) {
      process.stderr.write(`${message}\n`);
    } else {
      process.stderr.write(`${renderHelp()}\n`);
    }
    process.exitCode = 1;
  }
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

void main();
