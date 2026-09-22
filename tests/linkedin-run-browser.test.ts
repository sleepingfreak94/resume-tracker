import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

class FakeElement {
  innerText: string;
  textContent: string;
  tagName: string;
  id = "";
  title = "";
  disabled = false;
  hidden = false;
  parentElement: FakeElement | null = null;
  classList: string[];
  checked = false;
  queryElements: FakeElement[] = [];
  private attributes: Record<string, string>;
  private visible: boolean;
  private opacity: string;
  private badge: boolean;

  constructor(text: string, options: { ariaLabel?: string; classes?: string[]; visible?: boolean; tagName?: string; opacity?: string; badge?: boolean; attributes?: Record<string, string> } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.tagName = options.tagName ?? "BUTTON";
    this.classList = options.classes ?? [];
    this.attributes = { ...(options.attributes ?? {}), ...(options.ariaLabel ? { "aria-label": options.ariaLabel } : {}) };
    this.visible = options.visible ?? true;
    this.opacity = options.opacity ?? "1";
    this.badge = options.badge ?? false;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
  }

  querySelectorAll() {
    return this.queryElements;
  }

  querySelector(selector: string) {
    if (selector.includes(":checked")) return this.queryElements.find((element) => element.checked) ?? null;
    return this.queryElements[0] ?? null;
  }

  getBoundingClientRect() {
    return this.visible
      ? { width: this.tagName === "IFRAME" ? 304 : 120, height: this.tagName === "IFRAME" ? 78 : 40, top: 10, right: 314, bottom: 88, left: 10 }
      : { width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
  }

  matches(selector: string) {
    if (this.id && selector.split(",").some((part) => part.trim() === `#${this.id}`)) return true;
    if (selector.includes("captcha-response") && /captcha-response/i.test(Object.values(this.attributes).join(" "))) return true;
    if (selector.includes("aria-checked='true'") && this.getAttribute("aria-checked") === "true") return true;
    if (selector.includes("aria-selected='true'") && this.getAttribute("aria-selected") === "true") return true;
    if (selector.includes("class*='selected'") && this.classList.some((name) => /selected/i.test(name))) return true;
    if (selector.includes("class*='active'") && this.classList.some((name) => /active/i.test(name))) return true;
    if (selector.includes("jobs-document-upload-redesign-card__container") && this.classList.includes("jobs-document-upload-redesign-card__container")) return true;
    return false;
  }

  closest(selector: string): FakeElement | null {
    if (this.badge && selector.includes("captcha-badge")) return this;
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  computedStyle() {
    return {
      display: this.visible ? "block" : "none",
      visibility: "visible",
      opacity: this.opacity,
    };
  }
}

type BrowserHelpers = {
  submissionIsConfirmed: (expectedJobId?: string) => boolean;
  waitForSubmissionResult: (modal: FakeElement, timeoutMs: number, expectedJobId?: string) => Promise<boolean>;
  driveEasyApply: (port: number, runId: number, jobId: number, item: { url: string }) => Promise<{ submitted?: boolean; ok: boolean }>;
  waitFor: <T>(predicate: () => T | Promise<T>, timeoutMs?: number, intervalMs?: number) => Promise<T>;
  jobIdFromValue: (value: string) => string;
  findEasyApplyButton: (scope: { querySelectorAll: () => FakeElement[] }) => FakeElement | null;
  findExternalApplyButton: (scope: { querySelectorAll: () => FakeElement[] }) => FakeElement | null;
  canonicalJobUrl: (jobId: string) => string;
  meaningfulDescription: (description: string, title: string) => boolean;
  linkedInAppPortFromUrl: (value: string) => number | null;
  isRelevantLinkedInSearchResult: (title: string, keywords: string) => boolean;
  isInactiveRunError: (error: unknown) => boolean;
  userPauseCopy: (state: string, detail?: string) => { panel: string; checkpoint: string; note: string };
};

type AutofillHelpers = {
  armResumeUpload: (port: number, jobId: number) => unknown;
  checkArmedResumeUpload: () => Promise<void>;
  disarmResumeUpload: (options?: { notifyBackground: boolean }) => void;
  uploadResumeToVisibleFields: (options: { port: number; jobId: number; controls: [] }) => Promise<{ resumeUploaded: number; resumeUploadError: string | null }>;
  updateFinalReviewMessage: () => void;
  showAutomationMessage: (message: string, options?: { duration?: number }) => unknown;
  findApplicationAction: () => { element: FakeElement; final: boolean; label: string } | null;
  setFillRoot: (root: FakeElement | null) => void;
  runAutomationStep: (options: {
    port: number; jobId: number; questionsUnanswered: number; personalReview: string[];
    settings: { auto_continue: boolean; pause_on_unknown: boolean; wait_seconds: number };
  }) => Promise<{ state: string; continueHere?: boolean }>;
  personalReviewReasons: (entries?: Array<{ label: string }>) => string[];
  personalReviewReason: (reasons: string[]) => string;
  safetyPauseResult: (reasons: string[]) => { state: string; reasons: string[]; reason: string } | null;
  activeResumeUploadControls: (inputs: FakeElement[]) => Array<{ input: FakeElement | null; field: FakeElement; uploadButton?: FakeElement }>;
  visibleResumeUploadButton: (scope: { querySelectorAll: () => FakeElement[] }) => FakeElement | null;
  tailoredResumeFilename: (profile: { first_name?: string; last_name?: string }, format?: string) => string;
  resumeUploadFailureReason: (control: { input: FakeElement | null; field: FakeElement; uploadButton?: FakeElement }, index: number) => string;
  activeEasyApplyRoot: () => FakeElement | null;
  accessibleDocuments: () => Array<{ querySelectorAll: (selector: string) => unknown[] }>;
  markResumeUploadTarget: (input: FakeElement, token?: string) => string;
  clearResumeUploadTarget: (input: FakeElement, token: string) => void;
  resumeUploadClickTarget: (control: { input: FakeElement | null; field: FakeElement; uploadButton?: FakeElement }) => FakeElement | null;
  selectedResumeFilenamePresent: (scope: FakeElement, filename: string) => boolean;
  visibleResumeRequiredErrors: (scope: FakeElement) => FakeElement[];
  resumeAcceptanceState: (scope: FakeElement, filename: string) => { accepted: boolean; filenamePresent: boolean; requiredErrorVisible: boolean };
  runResumeUploadOnce: <T>(key: string, action: () => Promise<T> | T) => Promise<T>;
};

type DashboardHandoffHelpers = {
  dashboardHandoffFromUrl: (value: string) => { jobId: number; port: number } | null;
};

function loadBrowserHelpers(runtimeOverrides: Record<string, unknown> = {}, windowOverrides: Record<string, unknown> = {}): BrowserHelpers {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-linkedin-run.js"), "utf8");
  const windowObject: Record<string, unknown> = { __RT_LINKEDIN_RUN_TEST__: true, ...windowOverrides };
  const context = vm.createContext({
    window: windowObject,
    document: {},
    Element: FakeElement,
    Event,
    URL,
    URLSearchParams,
    Date,
    Math,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    ...runtimeOverrides,
  });
  (windowObject as { getComputedStyle?: (element: FakeElement) => object }).getComputedStyle = (element) => element.computedStyle();
  vm.runInContext(source, context);
  return windowObject.__rtLinkedInRunTest as BrowserHelpers;
}

function loadAutofillHelpers(
  captchaElements: FakeElement[],
  uploadElements: FakeElement[] = [],
  documentOverride?: Record<string, unknown>,
  runtimeOverrides: Record<string, unknown> = {},
): AutofillHelpers {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-autofill.js"), "utf8");
  const windowObject: Record<string, unknown> = { __RT_AUTOFILL_TEST__: true, location: runtimeOverrides.location || { hostname: "example.com" } };
  const documentObject = {
    querySelectorAll: (selector: string) => selector.includes("captcha") ? captchaElements : uploadElements,
  };
  const context = vm.createContext({
    window: windowObject,
    document: documentOverride || documentObject,
    Element: FakeElement,
    Event,
    URL,
    URLSearchParams,
    console,
    ...runtimeOverrides,
  });
  (windowObject as { getComputedStyle?: (element: FakeElement) => object }).getComputedStyle = (element) => element.computedStyle();
  vm.runInContext(source, context);
  return windowObject.__rtAutoFillTest as AutofillHelpers;
}

function loadDashboardHandoffHelpers(): DashboardHandoffHelpers {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-linkedin-handoff.js"), "utf8");
  const windowObject: Record<string, unknown> = { __RT_LINKEDIN_HANDOFF_TEST__: true };
  const context = vm.createContext({ window: windowObject, URL, URLSearchParams });
  vm.runInContext(source, context);
  return windowObject.__rtLinkedInHandoffTest as DashboardHandoffHelpers;
}

test("autofill recognizes Review variants and independent button labels", () => {
  const buttons = [
    new FakeElement("Review"),
    new FakeElement("Review", { ariaLabel: "Review your application" }),
    new FakeElement("Review application"),
    new FakeElement("Review your application"),
    new FakeElement("  REVIEW \n application →  "),
    new FakeElement("Check details", { ariaLabel: "  Review your application  " }),
    Object.assign(new FakeElement("", { tagName: "INPUT" }), { value: "Review" }),
    Object.assign(new FakeElement("Check details"), { title: "Review application" }),
    new FakeElement("Next", { ariaLabel: "Continue to next step" }),
    new FakeElement("Continue"),
  ];
  for (const button of buttons) {
    const action = loadAutofillHelpers([], [button]).findApplicationAction();
    assert.equal(action?.element, button);
    assert.equal(action?.final, false);
    assert.ok(action?.label.trim());
  }
  const unrelated = new FakeElement("Review company profile");
  assert.equal(loadAutofillHelpers([], [unrelated]).findApplicationAction(), null);
});

test("autofill treats conflicting submission labels as final review", () => {
  const buttons = [
    new FakeElement("Submit application"),
    new FakeElement("Review", { ariaLabel: "Submit application" }),
    new FakeElement("Submit application", { ariaLabel: "Next" }),
    Object.assign(new FakeElement("Review"), { value: "Submit application" }),
    Object.assign(new FakeElement("Next"), { title: "Send application" }),
  ];
  for (const button of buttons) {
    const action = loadAutofillHelpers([], [button]).findApplicationAction();
    assert.equal(action?.element, button);
    assert.equal(action?.final, true);
    assert.match(action?.label || "", /^(Submit|Send) application$/);
  }
});

test("autofill excludes hidden, disabled, extension, and out-of-scope actions", () => {
  const hidden = new FakeElement("Review", { visible: false });
  const disabled = Object.assign(new FakeElement("Review"), { disabled: true });
  const ariaDisabled = new FakeElement("Review", { attributes: { "aria-disabled": "true" } });
  const extensionPanel = Object.assign(new FakeElement("", { tagName: "DIV" }), { id: "rt-auto-progress" });
  const extensionButton = Object.assign(new FakeElement("Next"), { parentElement: extensionPanel });
  const ignored = [hidden, disabled, ariaDisabled, extensionButton];
  assert.equal(loadAutofillHelpers([], ignored).findApplicationAction(), null);

  const outside = new FakeElement("Next");
  const inside = new FakeElement("Review");
  const modal = new FakeElement("", { tagName: "DIV" });
  modal.queryElements = [...ignored, inside];
  const helpers = loadAutofillHelpers([], [outside]);
  helpers.setFillRoot(modal);
  assert.equal(helpers.findApplicationAction()?.element, inside);
  modal.queryElements = [];
  assert.equal(helpers.findApplicationAction(), null);
});

test("autofill prefers a separate continuation button over a final button", () => {
  const submit = new FakeElement("Submit application");
  const review = new FakeElement("Review");
  const action = loadAutofillHelpers([], [submit, review]).findApplicationAction();
  assert.equal(action?.element, review);
  assert.equal(action?.final, false);
});

test("automation advances Next and Review, then pauses without clicking Submit", async () => {
  // Exercise the real automation step with changing form controls and no network.
  let step = 0;
  const clicks: string[] = [];
  const messages: string[] = [];
  const buttons = ["Next", "Review", "Submit application"].map((label) =>
    Object.assign(new FakeElement(label), {
      click: () => { clicks.push(label); step++; },
    })
  );
  const controls = ["contact", "resume", "summary"].map((name) =>
    Object.assign(new FakeElement("", { tagName: "INPUT", ariaLabel: name }), { name })
  );
  const copy = { textContent: "" };
  const cancel = { style: {}, onclick: null };
  const panel = { querySelector: (selector: string) => selector === "#rt-auto-copy" ? copy : cancel };
  const documentObject = {
    getElementById: (id: string) => id === "rt-auto-progress" ? panel : null,
    querySelectorAll: (selector: string) => {
      if (selector.startsWith("button,")) return [buttons[step]];
      if (selector.startsWith("input,")) return [controls[step]];
      return [];
    },
  };
  const helpers = loadAutofillHelpers([], [], documentObject, {
    location: { pathname: "/jobs/search/", search: "", href: "https://www.linkedin.com/jobs/search/" },
    setTimeout: (callback: () => void) => { callback(); return 0; },
    chrome: { runtime: { sendMessage: (message: { type: string }, callback: (value: object) => void) => {
      messages.push(message.type);
      callback({ ok: true });
    } } },
  });
  const options = {
    port: 3000, jobId: 1, questionsUnanswered: 0, personalReview: [],
    settings: { auto_continue: true, pause_on_unknown: true, wait_seconds: 0 },
  };
  for (let i = 0; i < 2; i++) {
    const result = await helpers.runAutomationStep(options);
    assert.equal(result.state, "next");
    assert.equal(result.continueHere, true);
  }
  const final = await helpers.runAutomationStep(options);
  assert.equal(final.state, "final-review");
  assert.deepEqual(clicks, ["Next", "Review"]);
  assert.equal(messages.at(-1), "CLEAR_AUTOFILL_SESSION");
  assert.match(copy.textContent, /submit it yourself/);

  // A conflicting visible Review label must also stop before any click.
  buttons[2].innerText = "Review";
  buttons[2].setAttribute("aria-label", "Submit application");
  assert.equal((await helpers.runAutomationStep(options)).state, "final-review");
  assert.deepEqual(clicks, ["Next", "Review"]);
});

function submissionFixture() {
  const link = new FakeElement("See application Applied 7 seconds ago for Test Engineer", {
    tagName: "A", attributes: { href: "/jobs-tracker?stage=applied" },
  });
  const title = Object.assign(new FakeElement("Test Engineer", { tagName: "A" }), {
    href: "https://www.linkedin.com/jobs/view/4463908065/",
  });
  const state = { link: link as FakeElement | null, buttons: [] as FakeElement[], alerts: [] as FakeElement[], modalOpen: false };
  const modal = new FakeElement("Apply to Matchtech", { tagName: "DIV" });
  const location = { search: "?currentJobId=4463908065" };
  const detail = {
    querySelector: (selector: string) => selector === "#jobs-apply-see-application-link" ? state.link : selector.includes("h1 a") ? title : null,
    querySelectorAll: () => state.buttons,
  };
  const document = {
    querySelector: (selector: string) => selector === ".jobs-search__job-details" ? detail : null,
    querySelectorAll: (selector: string) => selector.includes("jobs-easy-apply-modal") ? (state.modalOpen ? [modal] : []) : state.alerts,
    contains: (element: unknown) => element === modal ? state.modalOpen : true,
  };
  return { link, title, state, modal, location, document };
}

test("LinkedIn recognizes the current applied-status link and legacy confirmations", () => {
  const fixture = submissionFixture();
  const helpers = loadBrowserHelpers({ document: fixture.document }, { location: fixture.location });
  assert.equal(helpers.submissionIsConfirmed("4463908065"), true);
  fixture.state.link = null;
  fixture.state.buttons = [new FakeElement("Applied")];
  assert.equal(helpers.submissionIsConfirmed("4463908065"), true);
  fixture.state.buttons = [];
  fixture.state.alerts = [new FakeElement("Your application was sent", { tagName: "DIV" })];
  assert.equal(helpers.submissionIsConfirmed("4463908065"), true);
});

test("LinkedIn rejects hidden, saved, malformed, unrelated, or other-job status links", () => {
  const fixture = submissionFixture();
  const helpers = loadBrowserHelpers({ document: fixture.document }, { location: fixture.location });
  for (const link of [
    new FakeElement("See application Applied yesterday", { visible: false, attributes: { href: "/jobs-tracker?stage=applied" } }),
    new FakeElement("See application Applied yesterday", { attributes: { href: "/jobs-tracker?stage=saved" } }),
    new FakeElement("See application Applied yesterday", { attributes: { href: "https://example.com/jobs-tracker?stage=applied" } }),
    new FakeElement("See application Applied yesterday", { attributes: { href: "http://[invalid" } }),
    new FakeElement("See application Not Applied", { attributes: { href: "/jobs-tracker?stage=applied" } }),
  ]) {
    fixture.state.link = link;
    assert.equal(helpers.submissionIsConfirmed("4463908065"), false);
  }
  fixture.state.link = fixture.link;
  assert.equal(helpers.submissionIsConfirmed("999"), false);
  fixture.title.href = "https://www.linkedin.com/jobs/view/999/";
  assert.equal(helpers.submissionIsConfirmed("4463908065"), false);
  fixture.state.link = null;
  // A generic Applied label elsewhere on the page must not count.
  fixture.state.alerts = [new FakeElement("Applied", { tagName: "DIV" })];
  assert.equal(helpers.submissionIsConfirmed(), false);
});

test("submission watcher accepts delayed inline confirmation but not modal closure or job navigation", async () => {
  for (const outcome of ["submitted", "closed", "navigated"]) {
    const fixture = submissionFixture();
    fixture.state.link = null;
    let now = 10_000;
    const helpers = loadBrowserHelpers({
      document: fixture.document,
      Date: { now: () => now },
      setTimeout: (callback: () => void, delay: number) => {
        now += delay;
        if (now >= 10_800 && outcome !== "closed") fixture.state.link = fixture.link;
        if (outcome === "navigated") fixture.location.search = "?currentJobId=999";
        callback();
      },
    }, { location: fixture.location });
    assert.equal(await helpers.waitForSubmissionResult(fixture.modal, 5000, "4463908065"), outcome === "submitted");
  }
});

test("manual-review driver records Applied and removes stale instructions after the current LinkedIn confirmation", async () => {
  const fixture = submissionFixture();
  fixture.state.link = null;
  const apply = Object.assign(new FakeElement("Easy Apply"), { click: () => { fixture.state.modalOpen = true; } });
  fixture.state.buttons = [apply];
  let removed = 0;
  const requests: Array<{ path: string; body?: { status?: string } }> = [];
  const panelControl = { style: {}, textContent: "", addEventListener: () => {} };
  const panel = { style: {}, querySelector: () => panelControl };
  const helpers = loadBrowserHelpers({
    document: {
      ...fixture.document,
      createElement: () => panel,
      body: { appendChild: () => {} },
      getElementById: (id: string) => id === "rt-auto-progress" ? { remove: () => { removed++; } } : null,
    },
    chrome: { runtime: { sendMessage: (message: { path: string; body?: { status?: string } }, callback: (value: object) => void) => {
      requests.push(message);
      callback({ ok: true, data: {} });
    } } },
  }, {
    location: fixture.location,
    __rtAutoFill: {
      armResumeUpload: () => {}, setFillRoot: () => {},
      autoApply: async () => {
        fixture.state.modalOpen = false;
        fixture.state.link = fixture.link;
        return { automation: { state: "final-review" } };
      },
    },
  });
  const result = await helpers.driveEasyApply(3000, 28, 106, { url: fixture.title.href });
  assert.equal(result.submitted, true);
  assert.equal(result.ok, true);
  assert.equal(removed, 1);
  assert.equal(requests.filter((request) => request.path === "/api/jobs/106" && request.body?.status === "applied").length, 1);
});

test("final-review banner expires with its submit control, without claiming successful submission", async () => {
  const button = new FakeElement("Submit application");
  let connected = true;
  let removed = 0;
  const copy = { textContent: "" };
  const panel = { remove: () => { removed++; }, querySelector: (selector: string) => selector === "#rt-auto-copy" ? copy : { style: {} } };
  const location = { href: "https://www.linkedin.com/jobs/search/?currentJobId=4463908065" };
  const helpers = loadAutofillHelpers([], [], {
    contains: () => connected,
    getElementById: () => panel,
    querySelectorAll: (selector: string) => selector.startsWith("button,") ? [button] : [],
  }, {
    location,
    chrome: { runtime: { sendMessage: (_message: unknown, callback: (value: object) => void) => callback({ ok: true }) } },
  });
  const options = { port: 3000, jobId: 106, questionsUnanswered: 0, personalReview: [], settings: { auto_continue: true, pause_on_unknown: true, wait_seconds: 0 } };
  await helpers.runAutomationStep(options);
  helpers.updateFinalReviewMessage();
  assert.equal(removed, 0);
  button.disabled = true; // Temporary submission/validation locking isn't closure.
  helpers.updateFinalReviewMessage();
  assert.equal(removed, 0);
  button.disabled = false;
  connected = false; // Success and cancellation both remove the obsolete instruction.
  helpers.updateFinalReviewMessage();
  assert.equal(removed, 1);
  assert.doesNotMatch(copy.textContent, /success|applied|submitted/i);
  connected = true;
  await helpers.runAutomationStep(options);
  location.href = "https://www.linkedin.com/jobs/search/?currentJobId=999";
  helpers.updateFinalReviewMessage();
  assert.equal(removed, 2);
  // A new personal-confirmation message must not inherit the final-review watcher.
  await helpers.runAutomationStep(options);
  helpers.showAutomationMessage("Paused for personal confirmation", { duration: 0 });
  connected = false;
  helpers.updateFinalReviewMessage();
  assert.equal(removed, 2);
});

test("a previous message timer cannot remove a newer persistent review notice", () => {
  const timers = new Map<number, () => void>();
  const copy = { textContent: "" };
  let removed = 0;
  const panel = { remove: () => { removed++; }, querySelector: (selector: string) => selector === "#rt-auto-copy" ? copy : { style: {} } };
  const helpers = loadAutofillHelpers([], [], { getElementById: () => panel }, {
    setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  helpers.showAutomationMessage("Opening Review…");
  assert.equal(timers.size, 1);
  helpers.showAutomationMessage("Review the application, then submit it yourself when ready.", { duration: 0 });
  for (const callback of timers.values()) callback();
  assert.equal(timers.size, 0);
  assert.equal(removed, 0);
  assert.match(copy.textContent, /submit it yourself/);
});

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

test("LinkedIn crawler reads only valid LinkedIn app-port handoffs", () => {
  const helpers = loadBrowserHelpers();
  assert.equal(helpers.linkedInAppPortFromUrl("https://www.linkedin.com/jobs/search/#resume-tracker-port=3002"), 3002);
  assert.equal(helpers.linkedInAppPortFromUrl("https://example.com/#resume-tracker-port=3002"), null);
  assert.equal(helpers.linkedInAppPortFromUrl("https://www.linkedin.com/jobs/search/#resume-tracker-port=70000"), null);
});

test("LinkedIn crawler skips promoted cards unrelated to the search keywords", () => {
  const helpers = loadBrowserHelpers();
  assert.equal(helpers.isRelevantLinkedInSearchResult("7 Axis Apprentice", "function test engineer"), false);
  assert.equal(helpers.isRelevantLinkedInSearchResult("Functional Test Engineer", "function test engineer"), true);
  assert.equal(helpers.isRelevantLinkedInSearchResult("QA Automation Engineer", "function test engineer"), true);
});

test("LinkedIn crawler stops its heartbeat after a dashboard run is stopped", () => {
  const helpers = loadBrowserHelpers();
  assert.equal(helpers.isInactiveRunError(new Error("Run is no longer active")), true);
  assert.equal(helpers.isInactiveRunError(new Error("Network unavailable")), false);
});

test("dashboard handoff preserves the tracked job and local app port", () => {
  const helpers = loadDashboardHandoffHelpers();
  const handoff = helpers.dashboardHandoffFromUrl("https://www.linkedin.com/jobs/view/4451084084#rt_job_id=66&resume-tracker-port=3002");
  assert.equal(handoff?.jobId, 66);
  assert.equal(handoff?.port, 3002);
  assert.equal(helpers.dashboardHandoffFromUrl("https://www.linkedin.com/jobs/view/4451084084#rt_job_id=0"), null);
  assert.equal(helpers.dashboardHandoffFromUrl("https://www.linkedin.com/jobs/view/4451084084#rt_job_id=66&resume-tracker-port=70000"), null);
});

test("autofill ignores LinkedIn's hidden global reCAPTCHA elements", () => {
  const helpers = loadAutofillHelpers([
    new FakeElement("", { tagName: "IFRAME", visible: false }),
    new FakeElement("", { tagName: "IFRAME", opacity: "0" }),
    new FakeElement("", { tagName: "TEXTAREA", attributes: { name: "g-recaptcha-response" } }),
    new FakeElement("", { badge: true }),
    new FakeElement("", { visible: false }),
  ]);
  const reasons = helpers.personalReviewReasons();
  assert.deepEqual(Array.from(reasons), []);
  assert.equal(helpers.safetyPauseResult(reasons), null);
});

test("autofill pauses for a visible CAPTCHA and names visible safety questions", () => {
  const helpers = loadAutofillHelpers([new FakeElement("", { tagName: "IFRAME" })]);
  const reasons = helpers.personalReviewReasons([{ label: "I certify that this application is accurate" }]);
  assert.deepEqual(Array.from(reasons), ["I certify that this application is accurate", "CAPTCHA challenge"]);
  assert.equal(helpers.personalReviewReason(reasons), "I certify that this application is accurate; CAPTCHA challenge");
  const pause = helpers.safetyPauseResult(reasons);
  assert.equal(pause?.state, "paused-safety");
  assert.equal(pause?.reason, "I certify that this application is accurate; CAPTCHA challenge");
});

function resumeInput(parentElement: FakeElement, label = "Resume / CV", visible = false) {
  const input = new FakeElement("", { ariaLabel: label, tagName: "INPUT", visible });
  input.parentElement = parentElement;
  return input;
}

test("autofill names auto-uploaded resumes from the profile and configured format", () => {
  const helpers = loadAutofillHelpers([]);
  assert.equal(helpers.tailoredResumeFilename({ first_name: "Kshitij", last_name: "Sharma" }), "KshitijSharma-Resume.docx");
  assert.equal(helpers.tailoredResumeFilename({ first_name: "Kshitij", last_name: "Sharma" }, "pdf"), "KshitijSharma-Resume.pdf");
});

test("autofill ignores hidden clone inputs but keeps CSS-hidden inputs for rendered LinkedIn resume fields", () => {
  const helpers = loadAutofillHelpers([]);
  const renderedField = new FakeElement("Resume", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"] });
  const hiddenClone = new FakeElement("Resume", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"], visible: false });
  const unlabelledResponseContainer = new FakeElement("", { tagName: "DIV" });
  const active = resumeInput(renderedField);
  const duplicate = resumeInput(renderedField);
  const clone = resumeInput(hiddenClone);
  const response = resumeInput(unlabelledResponseContainer);

  const controls = helpers.activeResumeUploadControls([active, duplicate, clone, response]);
  assert.equal(controls.length, 1);
  assert.equal(controls[0].input, active);
});

test("autofill exposes LinkedIn's visible Upload resume control when no file input is rendered", () => {
  const field = new FakeElement("Resume Upload resume", { tagName: "DIV", classes: ["jobs-resume-picker"] });
  const uploadButton = new FakeElement("Upload resume", { tagName: "BUTTON", ariaLabel: "Upload resume button" });
  uploadButton.parentElement = field;
  field.queryElements = [uploadButton];
  const helpers = loadAutofillHelpers([], [uploadButton]);

  assert.equal(helpers.visibleResumeUploadButton(field), uploadButton);
  const controls = helpers.activeResumeUploadControls([]);
  assert.equal(controls.length, 1);
  assert.equal(controls[0].input, null);
  assert.equal(controls[0].field, field);
  assert.equal(controls[0].uploadButton, uploadButton);

  const token = helpers.markResumeUploadTarget(uploadButton, "rt_test_chooser_button_1234");
  assert.equal(uploadButton.getAttribute("data-rt-cdp-upload-token"), token);
  helpers.clearResumeUploadTarget(uploadButton, token);
  assert.equal(uploadButton.getAttribute("data-rt-cdp-upload-token"), null);
});

test("autofill marks only the active input and removes the temporary CDP token after a rerender", () => {
  const helpers = loadAutofillHelpers([]);
  const renderedField = new FakeElement("Resume", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"] });
  const hiddenField = new FakeElement("Resume", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"], visible: false });
  const active = resumeInput(renderedField);
  const hiddenClone = resumeInput(hiddenField);
  const [control] = helpers.activeResumeUploadControls([hiddenClone, active]);
  assert.ok(control.input);
  const token = helpers.markResumeUploadTarget(control.input, "rt_test_active_input_1234");
  assert.equal(active.getAttribute("data-rt-cdp-upload-token"), token);
  assert.equal(hiddenClone.getAttribute("data-rt-cdp-upload-token"), null);

  const replacement = resumeInput(renderedField);
  assert.equal(helpers.activeResumeUploadControls([hiddenClone, replacement])[0].input, replacement);
  helpers.clearResumeUploadTarget(active, token);
  assert.equal(active.getAttribute("data-rt-cdp-upload-token"), null);
});

test("autofill accepts a visible selected résumé filename only after the required error disappears", () => {
  const helpers = loadAutofillHelpers([]);
  const scope = new FakeElement("Resume", { tagName: "DIV" });
  const selectedCard = new FakeElement("KshitijSharma-Resume.docx", {
    tagName: "DIV",
    classes: ["jobs-document-upload-redesign-card__container", "selected"],
  });
  const requiredError = new FakeElement("Resume is required", { tagName: "DIV" });
  scope.queryElements = [selectedCard, requiredError];

  assert.equal(helpers.selectedResumeFilenamePresent(scope, "KshitijSharma-Resume.docx"), true);
  assert.equal(helpers.visibleResumeRequiredErrors(scope).length, 1);
  assert.deepEqual({ ...helpers.resumeAcceptanceState(scope, "KshitijSharma-Resume.docx") }, {
    accepted: false,
    filenamePresent: true,
    requiredErrorVisible: true,
  });

  scope.queryElements = [selectedCard];
  assert.deepEqual({ ...helpers.resumeAcceptanceState(scope, "KshitijSharma-Resume.docx") }, {
    accepted: true,
    filenamePresent: true,
    requiredErrorVisible: false,
  });
});

test("LinkedIn probes hidden resume controls again after a non-resume step", async () => {
  let calls = 0;
  const helpers = loadAutofillHelpers([], [], undefined, {
    location: { hostname: "www.linkedin.com", href: "https://www.linkedin.com/jobs/view/123", pathname: "/jobs/view/123", search: "" },
    setTimeout, clearTimeout,
    chrome: { runtime: { sendMessage: (message: { type: string }, callback: (value: object) => void) => {
      assert.equal(message.type, "UPLOAD_RESUME_VIA_CDP");
      calls++;
      callback(calls === 1
        ? { ok: false, stage: "accessibility_target", cdpStatus: "not_started" }
        : { ok: false, stage: "validation", failure: { message: "Older resume is still selected" } });
    } } },
  });
  const options = { port: 3000, jobId: 66, controls: [] as [] };
  assert.equal((await helpers.uploadResumeToVisibleFields(options)).resumeUploadError, null);
  assert.equal((await helpers.uploadResumeToVisibleFields(options)).resumeUploadError, "Older resume is still selected");
  assert.equal((await helpers.uploadResumeToVisibleFields(options)).resumeUploadError, "Older resume is still selected");
  assert.equal(calls, 2);
});

test("dashboard watcher uploads an AX-only resume after an AX-only contact step and stops polling", async () => {
  let uploads = 0;
  let intervalStarted = false;
  let intervalStopped = false;
  const copy = { textContent: "" };
  const panel = { querySelector: (selector: string) => selector === "#rt-auto-copy" ? copy : { style: {} } };
  const helpers = loadAutofillHelpers([], [], {
    documentElement: {},
    querySelectorAll: () => [],
    getElementById: () => panel,
  }, {
    location: { hostname: "www.linkedin.com", href: "https://www.linkedin.com/jobs/view/123", pathname: "/jobs/view/123", search: "" },
    sessionStorage: { setItem() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {},
    setInterval: () => { intervalStarted = true; return 2; },
    clearInterval: () => { intervalStopped = true; },
    chrome: {
      storage: { local: { set: async () => {} } },
      runtime: { sendMessage: (message: { type: string }, callback: (value: object) => void) => {
        if (message.type === "LOCAL_API") return callback({ ok: true, data: { resume_format: "docx" } });
        assert.equal(message.type, "UPLOAD_RESUME_VIA_CDP");
        uploads++;
        callback(uploads === 1
          ? { ok: false, stage: "accessibility_target", cdpStatus: "not_started" }
          : { ok: true, filename: "Candidate-Resume-J66-123456789abc.docx" });
      } },
    },
  });
  helpers.armResumeUpload(3000, 66);
  assert.equal(intervalStarted, true);
  await helpers.checkArmedResumeUpload();
  assert.equal(copy.textContent, "", "a probe miss must not report an upload");
  assert.equal(intervalStopped, false);
  await helpers.checkArmedResumeUpload();
  assert.match(copy.textContent, /Verified selected résumé: Candidate-Resume-J66-123456789abc.docx/);
  assert.equal(intervalStopped, true);
  await helpers.checkArmedResumeUpload();
  assert.equal(uploads, 2, "a successful upload must not be repeated");
  helpers.disarmResumeUpload({ notifyBackground: false });
});

test("final review stops on an unverified attachment and displays the verified version only after a match", async () => {
  const button = new FakeElement("Submit application");
  const copy = { textContent: "" };
  const panel = { querySelector: (selector: string) => selector === "#rt-auto-copy" ? copy : { style: {} } };
  let verified = false;
  const messages: string[] = [];
  const helpers = loadAutofillHelpers([], [], {
    getElementById: () => panel,
    querySelectorAll: (selector: string) => selector.startsWith("button,") ? [button] : [],
  }, {
    location: { hostname: "www.linkedin.com", href: "https://www.linkedin.com/jobs/view/123", pathname: "/jobs/view/123", search: "" },
    setTimeout, clearTimeout,
    chrome: { runtime: { sendMessage: (message: { type: string }, callback: (value: object) => void) => {
      messages.push(message.type);
      callback(message.type !== "VERIFY_RESUME_SELECTION" || verified
        ? { ok: true, filename: "Candidate-Resume-J66-123456789abc.docx" }
        : { ok: false, failure: { message: "The older resume is selected" } });
    } } },
  });
  const options = { port: 3000, jobId: 66, questionsUnanswered: 0, personalReview: [], settings: { auto_continue: true, pause_on_unknown: true, wait_seconds: 0 } };
  assert.equal((await helpers.runAutomationStep(options)).state, "needs_manual");
  assert.match(copy.textContent, /older resume is selected/);
  verified = true;
  assert.equal((await helpers.runAutomationStep(options)).state, "final-review");
  assert.match(copy.textContent, /Verified attached résumé: Candidate-Resume-J66-123456789abc.docx/);
  assert.equal(messages.filter((type) => type === "VERIFY_RESUME_SELECTION").length, 2);
});

test("autofill does not accept a merely visible unselected resume card", () => {
  const helpers = loadAutofillHelpers([]);
  const scope = new FakeElement("Resume", { tagName: "DIV" });
  scope.queryElements = [new FakeElement("KshitijSharma-Resume.docx", { tagName: "DIV", classes: ["jobs-document-upload-redesign-card__container"] })];
  assert.equal(helpers.selectedResumeFilenamePresent(scope, "KshitijSharma-Resume.docx"), false);
});

test("autofill memoizes unresolved CDP validation and never invokes a second upload", async () => {
  const helpers = loadAutofillHelpers([]);
  let attempts = 0;
  const action = async () => {
    attempts++;
    return { ok: false, cdpStatus: "file_set", failure: { reason: "validation_unconfirmed" } };
  };
  const first = await helpers.runResumeUploadOnce("job-66-docx", action);
  const second = await helpers.runResumeUploadOnce("job-66-docx", action);
  assert.equal(attempts, 1);
  assert.equal(first, second);
});

test("autofill retains separate rendered resume requirements and identifies a failed field", () => {
  const helpers = loadAutofillHelpers([]);
  const primaryField = new FakeElement("Resume", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"] });
  const secondaryField = new FakeElement("Supporting CV", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"] });
  const primary = resumeInput(primaryField, "Resume");
  const secondary = resumeInput(secondaryField, "Supporting CV");

  const controls = helpers.activeResumeUploadControls([primary, secondary]);
  assert.equal(controls.length, 2);
  assert.equal(controls[0].input, primary);
  assert.equal(controls[1].input, secondary);
  assert.equal(helpers.resumeUploadFailureReason(controls[1], 1), "The tailored resume could not be assigned to Supporting CV.");
});

test("autofill marks the visible Upload control instead of a hidden file-input clone", () => {
  const helpers = loadAutofillHelpers([]);
  const field = new FakeElement("Resume", { tagName: "DIV", classes: ["jobs-easy-apply-form-element"] });
  const hiddenInput = new FakeElement("", { tagName: "INPUT", visible: false });
  const visibleUpload = new FakeElement("Upload resume", { tagName: "BUTTON" });
  field.queryElements = [hiddenInput, visibleUpload];
  assert.equal(helpers.resumeUploadClickTarget({ input: hiddenInput, field, uploadButton: visibleUpload }), visibleUpload);
});

test("autofill discovers the active Easy Apply root inside LinkedIn's same-origin preload iframe", () => {
  const dialog = new FakeElement("Apply to VLink Inc Resume Upload resume", {
    tagName: "DIV",
    attributes: { role: "dialog" },
  });
  const frameDocument = {
    querySelectorAll: (selector: string) => selector === "iframe" ? [] : selector.includes("role='dialog'") ? [dialog] : [],
  };
  const frame = { contentDocument: frameDocument };
  const topDocument = {
    querySelectorAll: (selector: string) => selector === "iframe" ? [frame] : [],
  };
  const helpers = loadAutofillHelpers([], [], topDocument);

  assert.equal(helpers.accessibleDocuments().length, 2);
  assert.equal(helpers.activeEasyApplyRoot(), dialog);
});

test("LinkedIn pause copy persists and displays the exact safety field", () => {
  const helpers = loadBrowserHelpers();
  const copy = helpers.userPauseCopy("paused-safety", "I certify that this application is accurate");
  assert.match(copy.panel, /I certify that this application is accurate/);
  assert.match(copy.checkpoint, /I certify that this application is accurate/);
  assert.match(copy.note, /I certify that this application is accurate/);
  assert.doesNotMatch(copy.note, /your safety confirmation/i);
});

test("LinkedIn auto-run source keeps tailoring and upload as hard gates", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-linkedin-run.js"), "utf8");
  const autofill = fs.readFileSync(path.join(process.cwd(), "extension", "content-autofill.js"), "utf8");
  const resumeCdp = fs.readFileSync(path.join(process.cwd(), "extension", "resume-cdp.js"), "utf8");
  assert.match(source, /result\.status !== "ready"/);
  assert.match(source, /tailoredArtifactExists !== true/);
  assert.match(source, /strict_auto_run:\s*true/);
  assert.doesNotMatch(source, /proceed with base resume/);
  assert.match(autofill, /state:\s*"needs_manual"/);
  assert.match(autofill, /tailoredResumeFilename/);
  assert.match(autofill, /armResumeUpload/);
  assert.doesNotMatch(autofill, /every visible upload control/);
  assert.doesNotMatch(autofill, /DataTransfer|new File\s*\(/);
  assert.match(autofill, /UPLOAD_RESUME_VIA_CDP/);
  assert.match(autofill, /\(\^\|\\\.\)linkedin\\\.com/);
  assert.match(autofill, /linkedInJobId:\s*linkedInPostingId\(\)/);
  assert.doesNotMatch(autofill, /uploadButtonCoordinates|uploadButton:\s*{/);
  assert.match(resumeCdp, /validation_unconfirmed/);
  assert.match(autofill, /paused-cover-letter/);
  assert.match(autofill, /\/api\/cover-letter\/\$\{jobId\}/);
  assert.match(source, /outcome:\s*"processing"/);
  assert.match(source, /heartbeat:\s*true/);
  assert.match(source, /LinkedIn sign-in is required/);
  assert.match(autofill, /Review the application, then submit it yourself/);
  assert.doesNotMatch(autofill, /Application submitted automatically/);
  assert.match(resumeCdp, /Page\.fileChooserOpened/);
  assert.match(resumeCdp, /backendNodeId/);
  assert.match(resumeCdp, /resumeUploadAttempt_v35_/);
  assert.doesNotMatch(resumeCdp, /function directSetFile/);
});

test("LinkedIn background binds a crawler to its run ID and refuses unsafe interrupted resumes", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");
  const popup = fs.readFileSync(path.join(process.cwd(), "extension", "popup.js"), "utf8");
  assert.match(source, /resume-tracker-port/);
  assert.match(source, /resume-tracker-run/);
  assert.match(source, /linkedInRunHandoff_/);
  assert.match(source, /Number\(data\.run\.id\) !== handoff\.runId/);
  assert.match(source, /savedPort:\s*String\(handoff\.port\)/);
  assert.match(source, /Refusing to resume an interrupted in-flight LinkedIn application/);
  assert.match(source, /DASHBOARD_AUTOFILL_HANDOFF/);
  assert.match(source, /dashboard-resume-watch/);
  assert.match(source, /armDashboardResumeUpload/);
  assert.match(source, /UPLOAD_RESUME_VIA_CDP/);
  assert.match(source, /RESUME_UPLOAD_STAGE/);
  assert.match(source, /GET_RESUME_UPLOAD_STATUS/);
  assert.match(source, /CLEAR_RESUME_UPLOAD_ATTEMPT/);
  assert.match(popup, /Résumé upload paused at/);
  assert.match(popup, /uploadLinkedInResumeFromPopup/);
  assert.match(popup, /type:\s*"UPLOAD_RESUME_VIA_CDP"/);
  assert.match(popup, /allFrames:\s*true/);
  assert.match(popup, /frameIds:\s*\[frameId\]/);
  assert.match(popup, /hasActiveApplicationDialog/);
  assert.match(source, /chrome\.tabs\.sendMessage\(tabId[\s\S]*\{ frameId \}\)/);
  assert.match(popup, /Clear Safe Pre-Upload Pause|clear-upload-pause-btn/);
  assert.doesNotMatch(popup, /Application submitted automatically/);
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "extension", "manifest.json"), "utf8"));
  assert.equal(manifest.version, "3.6.7");
  assert.ok(manifest.permissions.includes("debugger"));
});
