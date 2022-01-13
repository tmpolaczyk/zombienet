#!/usr/bin/env node

import { start } from "./orchestrator";
import { resolve } from "path";
import fs from "fs";
import { Network } from "./network";
import { getCredsFilePath, readNetworkConfig } from "./utils";
import { LaunchConfig } from "./types";
import { run } from "./test-runner";
import { Command, Option } from "commander";
import { AVAILABLE_PROVIDERS, DEFAULT_GLOBAL_TIMEOUT } from "./configManager";

const path = require("path");
const debug = require("debug")("zombie-cli");

const program = new Command("zombienet");

let network: Network;

// Ensure to log the uncaught exceptions
// to debug the problem, also exit because we don't know
// what happens there.
process.on("uncaughtException", async (err) => {
  if (network) {
    debug("removing namespace: " + network.namespace);
    await network.stop();
  }
  console.log(`uncaughtException`);
  console.log(err);
  debug(err);
  process.exit(100);
});

// Ensure that we know about any exception thrown in a promise that we
// accidentally don't have a 'catch' for.
// http://www.hacksrus.net/blog/2015/08/a-solution-to-swallowed-exceptions-in-es6s-promises/
process.on("unhandledRejection", async (err) => {
  if (network) {
    debug("removing namespace: " + network.namespace);
    await network.stop();
  }
  debug(err);
  console.log(`unhandledRejection`);
  console.log(err);
  process.exit(1001);
});

// Handle ctrl+c to trigger `exit`.
process.on("SIGINT", async function () {
  if (network) {
    debug("removing namespace: " + network.namespace);
    await network.stop();
  }
  process.exit(2);
});

process.on("exit", async function () {
  if (network) {
    debug("removing namespace: " + network.namespace);
    await network.uploadLogs();
    await network.stop();
  }
  const exitCode = process.exitCode !== undefined ? process.exitCode : 2;
  // use exitCode set by mocha or 2 as default.
  process.exit(exitCode);
});

program
  .command("spawn")
  .description("Spawn the network defined in the config")
  .argument("<networkConfig>", "Network config file path")
  .argument("[creds]", "kubeclt credentials file")
  .argument(
    "[monitor]",
    "Monitor flag, don't teardown the network with the cronjob."
  )
  .action(spawn);

program
  .addOption(
    new Option("-p, --provider <provider>", "Override provider to use")
      .choices(["podman", "kubernetes"])
      .default("kubernetes", "kubernetes")
  )
  .command("test")
  .description("Run tests on the network defined")
  .argument("<testFile>", "Feature file describing the tests")
  .action(test);

program
  .command("version")
  .description("Prints zombienet version")
  .action(() => {
    console.log("1.2.0");
  });

// spawn
async function spawn(
  configFile: string,
  credsFile: string | undefined,
  monitor: string | undefined,
  _opts: any
) {
  const opts = program.opts();
  const configPath = resolve(process.cwd(), configFile);
  if (!fs.existsSync(configPath)) {
    console.error("  ⚠ Config file does not exist: ", configPath);
    process.exit();
  }

  const filePath = path.resolve(configFile);
  const config = readNetworkConfig(filePath);

  debug(config);
  debug(opts);

  // if a provider is passed, let just use it.
  if (opts.provider && AVAILABLE_PROVIDERS.includes(opts.provider)) {
    if (!config.settings) {
      config.settings = {
        provider: opts.provider,
        timeout: DEFAULT_GLOBAL_TIMEOUT,
      };
    } else {
      config.settings.provider = opts.provider;
    }
  }

  let creds = "";
  if (config.settings?.provider === "kubernetes") {
    creds = getCredsFilePath(credsFile || "config") || "";
    if (!creds) {
      console.error("  ⚠ I can't find the Creds file: ", credsFile);
      process.exit();
    }
  }

  network = await start(creds, config, monitor !== undefined);
  network.showNetworkInfo();
}

// test
async function test(testFile: string, _opts: any) {
  const opts = program.opts();
  process.env.DEBUG = "zombie";
  const inCI = process.env.RUN_IN_CONTAINER === "1";
  // use `k8s` as default
  const providerToUse =
    opts.provider && AVAILABLE_PROVIDERS.includes(opts.provider)
      ? opts.provider
      : "kubernetes";
  await run(testFile, providerToUse, inCI);
}

program.parse(process.argv);
