#!/usr/bin/env node

import {
  loadLocalConfigFile,
  mergeCliOptions,
  normalizeConfig,
  parseCliArgs,
  renderHelp,
} from "./config";
import { runApp } from "./app";
import { toErrorMessage } from "./utils/errors";
import { writeFileEnsuringDir } from "./utils/files";
import { replaceExtension } from "./utils/paths";
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
      await writeFileEnsuringDir(htmlPath, renderHtmlReport(result));
      process.stdout.write(`Wrote HTML report to ${htmlPath}\n`);
    }
  } catch (error) {
    const message = toErrorMessage(error);
    if (message) {
      process.stderr.write(`${message}\n`);
    } else {
      process.stderr.write(`${renderHelp()}\n`);
    }
    process.exitCode = 1;
  }
}

void main();
