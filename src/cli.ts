#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  buildEffectiveConfigSnapshot,
  DEFAULT_LOCAL_CONFIG_FILE,
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
import { warnIfDistAppearsStale } from "./tool-identity";
import { renderHtmlReport } from "./visualizer/render";

async function main(): Promise<void> {
  try {
    warnIfDistAppearsStale();

    const parsedOptions = parseCliArgs(process.argv.slice(2));

    if (parsedOptions.help) {
      process.stdout.write(`${renderHelp()}\n`);
      process.exitCode = 0;
      return;
    }

    if (parsedOptions.ignoreLocalConfig && parsedOptions.configFile) {
      throw new Error("--config cannot be used with --ignore-local-config.");
    }

    const configFilePath = parsedOptions.ignoreLocalConfig
      ? null
      : path.resolve(parsedOptions.configFile ?? DEFAULT_LOCAL_CONFIG_FILE);
    const localConfig = configFilePath
      ? loadLocalConfigFile(
          process.cwd(),
          configFilePath,
          parsedOptions.configFile !== undefined,
        )
      : {};
    const options = mergeCliOptions(parsedOptions, localConfig);
    const config = normalizeConfig(options);

    if (options.showConfig) {
      const snapshot = buildEffectiveConfigSnapshot({
        config,
        options,
        localConfig,
        configFilePath,
        configFileLoaded: configFilePath !== null && fs.existsSync(configFilePath),
      });
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
      process.exitCode = 0;
      return;
    }

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
