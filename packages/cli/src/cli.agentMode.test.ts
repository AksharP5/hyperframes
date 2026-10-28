import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandDef } from "citty";
import { afterAll, describe, expect, it } from "vitest";
import { isDefinedCommand } from "./utils/defineCommand.js";
import { checkStudioWorkspaceBuild } from "./utils/workspaceBuildCheck.js";

// Runs every registered command the way a coding agent does: no terminal, stdin closed, CI set,
// an agent marker in the environment, and a home folder of its own. A new command is covered as
// soon as it is added to `commandLoaders` in cli.ts.

const srcDir = dirname(fileURLToPath(import.meta.url));
const cliEntry = join(srcDir, "cli.ts");
const home = mkdtempSync(join(tmpdir(), "hf-agent-mode-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const ANSI = "\u001b[";
const PROMPT = /\(y\/N\)|Yes \/ No|[◆◇]\s+[^\n]*\?\s*$/m;
const NAG = /Update available|auto-updated to|skills? out of date or missing/;

interface Registered {
  path: string[];
  command: CommandDef;
}

type Resolvable = CommandDef | Promise<CommandDef> | (() => CommandDef | Promise<CommandDef>);

async function resolveCommand(entry: Resolvable): Promise<CommandDef> {
  return typeof entry === "function" ? await entry() : await entry;
}

function registeredModules(): { name: string; file: string; exportName: string }[] {
  const source = readFileSync(cliEntry, "utf8");
  const block = source.match(/const commandLoaders = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  const entry =
    /^\s+"?([\w-]+)"?:[\s\S]*?import\("\.\/commands\/([\w/-]+)\.js"\)\.then\(\(m\) => m\.(\w+)\)/gm;
  return [...block.matchAll(entry)].map(([, name, file, exportName]) => ({
    name: name!,
    file: file!,
    exportName: exportName!,
  }));
}

async function walk(path: string[], command: CommandDef, out: Registered[]): Promise<void> {
  out.push({ path, command });
  const subCommands = (await resolveCommand(
    (command.subCommands ?? {}) as Resolvable,
  )) as unknown as Record<string, Resolvable>;
  for (const [name, sub] of Object.entries(subCommands)) {
    await walk([...path, name], await resolveCommand(sub), out);
  }
}

async function registeredCommands(): Promise<Registered[]> {
  const out: Registered[] = [];
  for (const { name, file, exportName } of registeredModules()) {
    const mod = (await import(`./commands/${file}.ts`)) as Record<string, CommandDef>;
    await walk([name], mod[exportName]!, out);
  }
  return out;
}

interface Run {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runAsAgent(args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", cliEntry, ...args], {
      cwd: home,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        CI: "1",
        CLAUDECODE: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function expectQuiet(run: Run): void {
  expect(run.signal, "finished before the timeout").toBeNull();
  const output = run.stdout + run.stderr;
  expect(output).not.toContain(ANSI);
  expect(output).not.toMatch(PROMPT);
  expect(output).not.toMatch(NAG);
}

const commands = await registeredCommands();
// From source, `preview` refuses to load until the studio packages are built; the test job does
// not build them, so preview is only spawned where they are.
const studioBuilt = checkStudioWorkspaceBuild(join(srcDir, "..", "..", "..")).length === 0;
const spawnable = commands.filter((c) => studioBuilt || c.path[0] !== "preview");

describe("agent-mode contract", () => {
  it("finds the registered commands", () => {
    expect(commands.length).toBeGreaterThan(50);
  });

  it.each(commands.map((c) => [c.path.join(" "), c] as const))(
    "%s is defined with the shared factory",
    (_label, { command }) => {
      expect(isDefinedCommand(command)).toBe(true);
    },
  );

  describe.concurrent("each command", () => {
    it.each(spawnable.map((c) => [c.path.join(" "), c.path] as const))(
      "%s --help prints plain help and exits 0",
      async (_label, path) => {
        const run = await runAsAgent([...path, "--help"]);
        expectQuiet(run);
        expect(run.code, run.stderr).toBe(0);
        expect(run.stdout).toContain("USAGE");
      },
    );

    it.each(spawnable.map((c) => [c.path.join(" "), c.path] as const))(
      "%s rejects an unknown flag with exit 2",
      async (_label, path) => {
        const run = await runAsAgent([...path, "--not-a-real-flag"]);
        expectQuiet(run);
        expect(run.code, run.stderr).toBe(2);
        expect(run.stdout).toBe("");
      },
    );
  });

  it.each([
    ["lambda progress"],
    ["cloudrun progress"],
    ["capture"],
    ["remove-background in.mp4"],
    ["init demo --resolution huge --non-interactive"],
  ])("`%s` is missing or misusing an argument, a usage error with exit 2", async (args) => {
    const run = await runAsAgent(args.split(" "));
    expectQuiet(run);
    expect(run.code, run.stderr).toBe(2);
  });
});
