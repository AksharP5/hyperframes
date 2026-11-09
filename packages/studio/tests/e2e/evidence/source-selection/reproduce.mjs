import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { launchStudioChrome } from "../../chrome-executable.mjs";

const mode = process.argv[2] ?? "before";
const url = "http://127.0.0.1:5197/#project/source-selection-proof";
const { browser } = await launchStudioChrome();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("hyperframes-studio:telemetryDisabled", "1");
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle2", timeout: 120_000 });
  await page.waitForSelector('[aria-label="Open composition groups"]', { timeout: 60_000 });
  await page.locator('button ::-p-text(Window)').click();
  const codeItem = page.locator('[role="menuitemcheckbox"] ::-p-text(Code)');
  const codeOpen = await page.evaluate(() => [...document.querySelectorAll('[role="menuitemcheckbox"]')].find((item) => item.textContent.trim().endsWith("Code"))?.getAttribute("aria-checked"));
  if (codeOpen !== "true") await codeItem.click();
  await page.locator('button ::-p-text(Window)').click();
  await page.locator('[role="tab"] ::-p-text(Code)').click();
  await page.waitForSelector(".cm-content", { timeout: 30_000 });

  await page.locator('[role="tab"] ::-p-text(Compositions)').click();
  let held;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const target = new URL(request.url());
    if (target.pathname.endsWith("/files/groups.html") && !target.search && !held) {
      held = request;
      return;
    }
    void request.continue();
  });
  await page.locator('[aria-label="Open composition groups"]').click();
  const deadline = Date.now() + 10_000;
  while (!held && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert(held, "The first composition source request was not held");
  await page.locator('[aria-label="Open composition index"]').click();
  await page.locator('[role="tab"] ::-p-text(Code)').click();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("New track fixture"));
  await held.continue();
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });

  const result = await page.evaluate(() => ({
    hash: location.hash,
    sourceTitle: document.querySelector(".cm-content")?.textContent.match(/<title>(.*?)<\/title>/)?.[1],
    previewRoot: document.querySelector("hyperframes-player")?.shadowRoot?.querySelector("iframe")?.contentDocument?.querySelector("[data-composition-id]")?.getAttribute("data-composition-id"),
  }));
  result.mode = mode;
  result.browser = await browser.version();
  result.errors = errors;
  await page.screenshot({ path: new URL(`${mode}.png`, import.meta.url).pathname });
  await writeFile(new URL(`${mode}.json`, import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.equal(result.previewRoot, "ghost-lane", "Preview selection moved away from index.html");
  assert.equal(result.sourceTitle, mode === "before" ? "Grouped track drop fixture" : "New track fixture");
} finally {
  await browser.close();
}
