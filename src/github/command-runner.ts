import { spawn } from "node:child_process";
import { CommandRunner, GitHubRunnerResult } from "../types";

export class NodeCommandRunner implements CommandRunner {
  public async run(
    command: string,
    args: string[],
    options?: { input?: string },
  ): Promise<GitHubRunnerResult> {
    return await new Promise<GitHubRunnerResult>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: "pipe",
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      if (options?.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
  }
}
