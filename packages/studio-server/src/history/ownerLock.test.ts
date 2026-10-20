import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryBusyError, takeHistoryOwnership } from "./ownerLock";

const platform = process.platform;
const homes: string[] = [];
// Root reads a mode-000 file anyway, so the refused read below needs an ordinary user.
const canRefuseRead = process.platform !== "win32" && process.getuid?.() !== 0;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** A home whose owner.pid a live process holds, refuses reads, and vanishes after `ms`, as Windows does mid-delete. */
function deletingOwner(ms: number): string {
  const home = mkdtempSync(join(tmpdir(), "hf-owner-lock-"));
  homes.push(home);
  const lock = join(home, "owner.pid");
  writeFileSync(lock, String(process.ppid));
  chmodSync(lock, 0o000);
  setTimeout(() => rmSync(lock, { force: true }), ms).unref();
  return home;
}

describe.skipIf(!canRefuseRead)("takeHistoryOwnership", () => {
  it("on Windows, waits out an owner.pid it cannot read while another process deletes it", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const home = deletingOwner(200);
    const release = await takeHistoryOwnership(home, 5_000);
    expect(existsSync(join(home, "owner.pid"))).toBe(true);
    release();
  });

  it("still fails at once on an unreadable lock outside Windows", async () => {
    await expect(takeHistoryOwnership(deletingOwner(200), 5_000)).rejects.toThrow(/EACCES/);
  });

  it("still gives up at the deadline while the lock stays unreadable", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    await expect(takeHistoryOwnership(deletingOwner(60_000), 300)).rejects.toThrow(/EACCES/);
  });

  it("still gives up at the deadline while a live owner holds the lock", async () => {
    const home = mkdtempSync(join(tmpdir(), "hf-owner-lock-"));
    homes.push(home);
    writeFileSync(join(home, "owner.pid"), String(process.ppid));
    await expect(takeHistoryOwnership(home, 100)).rejects.toThrow(HistoryBusyError);
  });
});
