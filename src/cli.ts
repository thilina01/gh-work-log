#!/usr/bin/env node

import {
  loadLocalConfigFile,
  mergeCliOptions,
  normalizeConfig,
  parseCliArgs,
  renderHelp,
} from "./config";
import { runApp } from "./app";

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
    await runApp(config);
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

void main();
