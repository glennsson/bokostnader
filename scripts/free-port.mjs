/**
 * Frigjør en lokal port før dev-server startes (unngår EADDRINUSE).
 * Bruk: node scripts/free-port.mjs 8787
 */
import { execSync } from "node:child_process";

const port = process.argv[2] ?? "8787";

function freePortWindows(targetPort) {
  try {
    const output = execSync(`netstat -ano | findstr :${targetPort}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) {
        continue;
      }
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        console.log(`[free-port] Stoppet prosess ${pid} på port ${targetPort}`);
      } catch {
        // ignore
      }
    }
  } catch {
    // ingen prosess på porten
  }
}

function freePortUnix(targetPort) {
  try {
    const output = execSync(`lsof -ti :${targetPort}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    for (const pid of output.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`[free-port] Stoppet prosess ${pid} på port ${targetPort}`);
      } catch {
        // ignore
      }
    }
  } catch {
    // ingen prosess på porten
  }
}

if (process.platform === "win32") {
  freePortWindows(port);
} else {
  freePortUnix(port);
}
