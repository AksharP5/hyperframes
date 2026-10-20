import { execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export function testProcessIsAlive(pid: number): boolean {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const state = stat.slice(stat.lastIndexOf(") ") + 2)[0];
      return state !== "Z" && state !== "X";
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForTestCondition(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Condition not met within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function processTable(): Map<number, { parent: number; name: string }> {
  const table = new Map<number, { parent: number; name: string }>();
  if (process.platform === "linux") {
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, "utf8");
        table.set(Number(name), {
          parent: Number(stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[1]),
          name: stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")")),
        });
      } catch {}
    }
    return table;
  }
  const listing =
    process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }',
          ],
          { encoding: "utf8" },
        )
      : execFileSync("ps", ["-A", "-o", "pid=,ppid=,comm="], { encoding: "utf8" });
  for (const line of listing.split("\n")) {
    const [pid, parent, ...name] = line.trim().split(/\s+/);
    if (Number(pid) > 0) table.set(Number(pid), { parent: Number(parent), name: name.join(" ") });
  }
  return table;
}

export function testProcessDescendants(parentPid: number, named?: RegExp): number[] {
  const table = processTable();
  const owned = new Set([parentPid]);
  for (const pid of owned) {
    for (const [child, entry] of table) if (entry.parent === pid) owned.add(child);
  }
  return [...owned].filter(
    (pid) => pid !== parentPid && (!named || named.test(table.get(pid)?.name ?? "")),
  );
}

export async function stopTestProcesses(
  root: ChildProcess,
  ownedPids: readonly number[],
): Promise<void> {
  const rootExited = () => root.exitCode !== null || root.signalCode !== null;
  if (!rootExited()) {
    root.kill("SIGTERM");
    await waitForTestCondition(rootExited, 5_000).catch(() => undefined);
  }
  try {
    for (const pid of ownedPids) {
      if (testProcessIsAlive(pid)) process.kill(pid, "SIGKILL");
    }
    await waitForTestCondition(() => ownedPids.every((pid) => !testProcessIsAlive(pid)), 5_000);
  } finally {
    if (!rootExited()) {
      root.kill("SIGKILL");
      await waitForTestCondition(rootExited, 5_000);
    }
  }
}
