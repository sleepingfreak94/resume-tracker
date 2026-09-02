import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

class FakeElement {
  innerText: string;
  textContent: string;
  tagName: string;
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

function loadBrowserHelpers(): BrowserHelpers {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-linkedin-run.js"), "utf8");
  const windowObject: Record<string, unknown> = { __RT_LINKEDIN_RUN_TEST__: true };
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
  });
  (windowObject as { getComputedStyle?: (element: FakeElement) => object }).getComputedStyle = (element) => element.computedStyle();
  vm.runInContext(source, context);
  return windowObject.__rtLinkedInRunTest as BrowserHelpers;
}

function loadAutofillHelpers(
  captchaElements: FakeElement[],
  uploadElements: FakeElement[] = [],
  documentOverride?: Record<string, unknown>,
): AutofillHelpers {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "content-autofill.js"), "utf8");
  const windowObject: Record<string, unknown> = { __RT_AUTOFILL_TEST__: true };
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
  assert.equal(manifest.version, "3.6.1");
  assert.ok(manifest.permissions.includes("debugger"));
});
