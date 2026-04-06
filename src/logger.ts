export class Logger {
  public constructor(
    private readonly verbose: boolean,
    private readonly stderr: NodeJS.WritableStream = process.stderr,
  ) {}

  public info(message: string): void {
    this.stderr.write(`${message}\n`);
  }

  public debug(message: string): void {
    if (this.verbose) {
      this.stderr.write(`${message}\n`);
    }
  }
}
