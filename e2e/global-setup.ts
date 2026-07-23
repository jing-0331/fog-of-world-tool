import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

const SERVER_URL = "http://127.0.0.1:3000";

export default async function globalSetup() {
  if (await serverIsReady()) {
    return;
  }

  const nextBin = join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const server = spawn(process.execPath, [nextBin, "start"], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: { ...process.env, NODE_ENV: "production" },
    stdio: "ignore",
  });
  server.unref();

  await waitForServer(server);

  return async () => {
    if (!server.pid) {
      return;
    }
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    }
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // The server may already have exited after the test run.
    }
  };
}

async function waitForServer(
  server: ReturnType<typeof spawn>,
  timeoutMilliseconds = 30_000,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMilliseconds) {
    if (server.exitCode !== null) {
      throw new Error(
        `Next.js E2E server exited early with code ${server.exitCode}.`,
      );
    }
    if (await serverIsReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for ${SERVER_URL} after ${timeoutMilliseconds}ms.`,
  );
}

async function serverIsReady(): Promise<boolean> {
  try {
    const response = await fetch(SERVER_URL, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
