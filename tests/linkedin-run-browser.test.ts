import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

class FakeElement {
  innerText: string;
  textContent: string;
  title = "";
  disabled = false;
  classList: string[];
  private attributes: Record<string, string>;
  private visible: boolean;

  constructor(text: string, options: { ariaLabel?: string; classes?: string[]; visible?: boolean } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.classList = options.classes ?? [];
    this.attributes = options.ariaLabel ? { "aria-label": options.ariaLabel } : {};
    this.visible = options.visible ?? true;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  getBoundingClientRect() {
    return this.visible
      ? { width: 120, height: 40, top: 10, right: 130, bottom: 50, left: 10 }
      : { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
  }
}

type BrowserHelpers = {
  waitFor: <T>(predicate: () => T | Promise<T>, timeoutMs?: number, intervalMs?: number) => Promise<T>;
  jobIdFromValue: (value: string) => string;
  findEasyApplyButton: (scope: { querySelectorAll: () => FakeElement[] }) => FakeElement | null;
  findExternalApplyButton: (scope: { querySelectorAll: () => FakeElement[] }) => FakeElement | null;
  canonicalJobUrl: (jobId: string) => string;
  meaningfulDescription: (description: string, title: string) => boolean;
};

function loadBrowserHelpers(): BrowserHelpers {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-linkedin-run.js"), "utf8");
  const windowObject: Record<string, unknown> = { __RT_LINKEDIN_RUN_TEST__: true };
  const context = vm.createContext({
    window: windowObject,
    document: {},
    Element: FakeElement,
    Event,
    URLSearchParams,
    Date,
    Math,
    Promise,
    console,
    setTimeout,
    clearTimeout,
  });
  (windowObject as { getComputedStyle?: (element: FakeElement) => object }).getComputedStyle = (element) => ({
    display: element.getBoundingClientRect().width ? "block" : "none",
    visibility: "visible",
    opacity: "1",
  });
  vm.runInContext(source, context);
  return windowObject.__rtLinkedInRunTest as BrowserHelpers;
}

test("LinkedIn crawler waits for asynchronous predicates instead of accepting a Promise as success", async () => {
  const helpers = loadBrowserHelpers();
  let attempts = 0;
  const result = await helpers.waitFor(async () => {
    attempts++;
    return attempts === 3 ? "ready" : "";
  }, 500, 5);
  assert.equal(result, "ready");
  assert.equal(attempts, 3);
});

test("LinkedIn crawler recognizes visible Easy Apply variants and ignores hidden stale buttons", () => {
  const helpers = loadBrowserHelpers();
  const hidden = new FakeElement("Easy Apply", { visible: false });
  const visible = new FakeElement("Easy Apply to Senior QA Engineer");
  const scope = { querySelectorAll: () => [hidden, visible] };
  assert.equal(helpers.findEasyApplyButton(scope), visible);
  assert.equal(helpers.findExternalApplyButton(scope), null);
});

test("LinkedIn crawler distinguishes an external Apply button", () => {
  const helpers = loadBrowserHelpers();
  const external = new FakeElement("Apply on company website");
  const scope = { querySelectorAll: () => [external] };
  assert.equal(helpers.findEasyApplyButton(scope), null);
  assert.equal(helpers.findExternalApplyButton(scope), external);
});

test("LinkedIn crawler recognizes the current LinkedIn-branded Apply control as Easy Apply", () => {
  const helpers = loadBrowserHelpers();
  const nativeApply = new FakeElement("Apply LinkedIn", { ariaLabel: "Apply to QE Automation at Tata Consultancy Services" });
  const scope = { querySelectorAll: () => [nativeApply] };
  assert.equal(helpers.findEasyApplyButton(scope), nativeApply);
  assert.equal(helpers.findExternalApplyButton(scope), null);
});

test("LinkedIn crawler extracts job IDs from view URLs and currentJobId query values", () => {
  const helpers = loadBrowserHelpers();
  assert.equal(helpers.jobIdFromValue("https://www.linkedin.com/jobs/view/senior-qa-4450328308"), "4450328308");
  assert.equal(helpers.jobIdFromValue("https://www.linkedin.com/jobs/search/?currentJobId=4449784407"), "4449784407");
  assert.equal(helpers.jobIdFromValue("4451084084"), "4451084084");
});

test("LinkedIn crawler rejects title-only descriptions and creates canonical URLs", () => {
  const helpers = loadBrowserHelpers();
  assert.equal(helpers.canonicalJobUrl("4451084084"), "https://www.linkedin.com/jobs/view/4451084084");
  assert.equal(helpers.meaningfulDescription("Senior QA", "Senior QA"), false);
  assert.equal(helpers.meaningfulDescription("A".repeat(120), "Senior QA"), true);
});

test("LinkedIn auto-run source keeps tailoring and upload as hard gates", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-linkedin-run.js"), "utf8");
  const autofill = fs.readFileSync(path.join(process.cwd(), "extension", "content-autofill.js"), "utf8");
  assert.match(source, /result\.status !== "ready"/);
  assert.match(source, /tailoredArtifactExists !== true/);
  assert.match(source, /strict_auto_run:\s*true/);
  assert.doesNotMatch(source, /proceed with base resume/);
  assert.match(autofill, /paused-resume-upload/);
  assert.match(autofill, /paused-cover-letter/);
  assert.match(autofill, /\/api\/cover-letter\/\$\{jobId\}/);
});
