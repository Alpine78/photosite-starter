import { spawn, type ChildProcess } from "node:child_process";
import { createServer, connect } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";
import { appUnderTestEnvironment } from "./harness-environment";

/** Test-only generations of the same production build, on one owned loopback port. */
export async function createMaintenanceGeneration() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (address === null || typeof address === "string") throw new Error("Expected a loopback port");
  const port = address.port;
  await new Promise<void>((done, fail) => reservation.close((error) => error ? fail(error) : done()));
  let child: ChildProcess | undefined;
  let closed: Promise<unknown> | undefined;
  let output = "";
  const logs: { mode: string; output: string }[] = [];

  async function stop() {
    const running = child;
    const completion = closed;
    child = undefined;
    closed = undefined;
    if (!running) return;
    if (running.exitCode === null && running.signalCode === null) running.kill("SIGTERM");
    const force = setTimeout(() => running.kill("SIGKILL"), 10_000);
    // close follows stdout/stderr closure; a log-absence assertion needs all bytes.
    try { await completion; } finally { clearTimeout(force); }
  }

  return {
    origin: `http://127.0.0.1:${port}`,
    logs,
    get output() { return output; },
    stop,
    async start(mode: string, extra: Record<string, string> = {}) {
      await stop();
      output = "";
      const record = { mode, output: "" };
      logs.push(record);
      child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
        env: { ...process.env, ...appUnderTestEnvironment, SITE_MAINTENANCE_MODE: mode, ...extra },
        stdio: ["ignore", "pipe", "pipe"],
      });
      closed = once(child, "close");
      const capture = (data: Buffer) => { output += data.toString(); record.output = output; };
      child.stdout!.on("data", capture);
      child.stderr!.on("data", capture);
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Test generation exited: ${output}`);
        const ready = await new Promise<boolean>((done) => {
          const socket = connect(port, "127.0.0.1");
          socket.once("connect", () => { socket.destroy(); done(true); });
          socket.once("error", () => done(false));
        });
        if (ready) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw new Error(`Test generation did not listen: ${output}`);
    },
  };
}
