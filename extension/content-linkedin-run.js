// content-linkedin-run.js — LinkedIn auto-apply crawl loop
// Injected by background.js into linkedin.com/jobs/search pages when an
// active run exists in the local app.

(function () {
  if (window.__rtLinkedInRunActive) return;
  window.__rtLinkedInRunActive = true;

  // ── Local API proxy (routes through background.js) ──────────────────────

  function callApi(port, path, { method = "GET", body } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "LOCAL_API", port, path, method, body },
        (resp) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!resp?.ok) { reject(new Error(resp?.error || `API error ${resp?.status}`)); return; }
          resolve(resp.data);
        }
      );
    });
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function jitter(minMs, maxMs) { return wait(minMs + Math.random() * (maxMs - minMs)); }

  async function waitFor(predicate, timeoutMs = 10_000, intervalMs = 300) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const result = await predicate();
        if (result) return result;
      } catch (err) {
        lastError = err;
      }
      await wait(intervalMs);
    }
    throw new Error(lastError ? `Timeout: ${lastError.message || lastError}` : "Timeout");
  }

  // ── Progress panel ───────────────────────────────────────────────────────

  let progressPanel = null;
  let stopRequested = false;

  function ensurePanel() {
    if (progressPanel && document.contains(progressPanel)) return progressPanel;
    progressPanel = document.createElement("div");
    progressPanel.id = "rt-run-progress";
    progressPanel.style.cssText = [
      "position:fixed;right:24px;bottom:24px;z-index:2147483647",
      "width:min(320px,calc(100vw - 32px));padding:14px 16px",
      "border-radius:14px;border:1px solid rgba(99,202,183,.35)",
      "background:#0d1016;color:#f5f5f4;box-shadow:0 18px 50px rgba(0,0,0,.45)",
      "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    ].join(";");

    progressPanel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <strong style="color:#63cab7;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Resume Tracker</strong>
        <button id="rt-run-stop" style="border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.05);color:#f87171;padding:3px 10px;font-size:12px;font-weight:600;cursor:pointer">Stop</button>
      </div>
      <div id="rt-run-msg" style="color:#e5e7eb;margin-bottom:4px"></div>
      <div id="rt-run-sub" style="color:#6b7280;font-size:11px"></div>
      <button id="rt-run-resume" type="button" style="display:none;margin-top:10px;width:100%;border:0;border-radius:9px;background:#63cab7;color:#111318;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer">Resume automation</button>
    `;
    document.body.appendChild(progressPanel);

    progressPanel.querySelector("#rt-run-stop").addEventListener("click", async () => {
      stopRequested = true;
      showMsg("Stopping after current job…", "");
    });

    return progressPanel;
  }

  function showMsg(msg, sub = "") {
    const panel = ensurePanel();
    panel.querySelector("#rt-run-msg").textContent = msg;
    panel.querySelector("#rt-run-sub").textContent = sub;
  }

  function hideResumeButton() {
    const button = ensurePanel().querySelector("#rt-run-resume");
    button.style.display = "none";
    button.onclick = null;
  }

  function removePanel() {
    progressPanel?.remove();
    progressPanel = null;
  }

  // ── Job card helpers ─────────────────────────────────────────────────────

  function getJobCards() {
    return Array.from(document.querySelectorAll([
      "li.jobs-search-results__list-item",
      "li.scaffold-layout__list-item",
      "div[data-job-id]",
      ".job-card-container",
      ".jobs-search__results-list > li",
      ".jobs-search-results-grid__row-container li",
    ].join(",")));
  }

  function jobIdFromValue(value) {
    const normalized = String(value || "").trim();
    if (/^\d+$/.test(normalized)) return normalized;
    const match = normalized.match(/(?:currentJobId=|\/jobs\/view\/(?:[^/?#]*-)?)(\d+)/i);
    return match?.[1] || "";
  }

  function getCardJobId(card) {
    if (!(card instanceof Element)) return "";
    const dataId = card.getAttribute("data-job-id") || card.closest("[data-job-id]")?.getAttribute("data-job-id");
    return jobIdFromValue(dataId) || jobIdFromValue(card.querySelector("a[href*='/jobs/view/']")?.href);
  }

  function getCardByJobId(jobId) {
    return getJobCards().find((card) => getCardJobId(card) === String(jobId)) || null;
  }

  function getScrollableResultsContainer() {
    const firstCard = getJobCards()[0];
    let candidate = firstCard?.parentElement || null;
    while (candidate && candidate !== document.body) {
      const style = window.getComputedStyle(candidate);
      if (/auto|scroll/i.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 20) return candidate;
      candidate = candidate.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function setScrollPosition(container, top) {
    if (container === document.scrollingElement || container === document.documentElement || container === document.body) {
      window.scrollTo(0, top);
    } else {
      container.scrollTop = top;
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  async function collectJobTargets(maxJobs) {
    const targets = new Map();
    const container = getScrollableResultsContainer();
    let unchangedRounds = 0;
    for (let round = 0; round < 30 && targets.size < maxJobs && !stopRequested; round++) {
      const before = targets.size;
      for (const card of getJobCards()) {
        const jobId = getCardJobId(card);
        if (jobId && !targets.has(jobId)) targets.set(jobId, { jobId });
      }
      unchangedRounds = targets.size === before ? unchangedRounds + 1 : 0;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextTop = Math.min(maxTop, (container.scrollTop || window.scrollY || 0) + Math.max(450, container.clientHeight * 0.8));
      if (nextTop >= maxTop && unchangedRounds >= 2) break;
      setScrollPosition(container, nextTop);
      await wait(700);
    }
    setScrollPosition(container, 0);
    await wait(700);
    return Array.from(targets.values()).slice(0, maxJobs);
  }

  async function findCardForJob(jobId) {
    const container = getScrollableResultsContainer();
    let card = getCardByJobId(jobId);
    if (card) return card;

    setScrollPosition(container, 0);
    for (let round = 0; round < 35 && !stopRequested; round++) {
      await wait(350);
      card = getCardByJobId(jobId);
      if (card) return card;
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const currentTop = container.scrollTop || window.scrollY || 0;
      if (currentTop >= maxTop) break;
      setScrollPosition(container, Math.min(maxTop, currentTop + Math.max(400, container.clientHeight * 0.75)));
    }
    return null;
  }

  function clickCard(card) {
    card.scrollIntoView({ block: "center" });
    const link = card.querySelector("a[href*='/jobs/view/']");
    if (link) { link.click(); return; }
    card.click();
  }

  function getDetailSignature() {
    const panel = getJobDetailPanel();
    const title = panel.querySelector([
      "h1",
      ".job-details-jobs-unified-top-card__job-title",
      "[class*='job-title']",
    ].join(","));
    const company = panel.querySelector([
      ".job-details-jobs-unified-top-card__company-name",
      "[class*='company-name']",
      "[class*='company'] a",
    ].join(","));
    const actions = Array.from(panel.querySelectorAll("button, a, [role='button']"))
      .filter(isVisible)
      .map((element) => easyApplyText(element))
      .filter(Boolean)
      .slice(0, 12)
      .join("|");
    return [title?.textContent, company?.textContent, actions]
      .map((value) => String(value || "").replace(/\s+/g, " ").trim())
      .join("::");
  }

  async function waitForDetailPanel(prevJobId, expectedJobId, previousSignature) {
    const jobChanged = Boolean(expectedJobId && expectedJobId !== prevJobId);
    const result = await waitFor(() => {
      const id = getCurrentJobId();
      if (expectedJobId && id !== expectedJobId) return null;
      if (!expectedJobId && (!id || id === prevJobId)) return null;
      if (jobChanged) {
        const signature = getDetailSignature();
        if (!signature || signature === previousSignature) return null;
      }
      return id;
    }, 15_000, 250);
    // LinkedIn often replaces action controls shortly after the title changes.
    await wait(900);
    return result;
  }

  function getCurrentJobId() {
    const params = new URLSearchParams(window.location.search);
    const queryId = params.get("currentJobId");
    if (queryId) return queryId;

    const panel = getJobDetailPanel();
    const titleLink = panel.querySelector([
      "h1 a[href*='/jobs/view/']",
      "a.job-details-jobs-unified-top-card__job-title-link[href*='/jobs/view/']",
      "[class*='job-title'] a[href*='/jobs/view/']",
    ].join(","));
    return jobIdFromValue(titleLink?.href) || "";
  }

  function canonicalJobUrl(jobId) {
    return /^\d+$/.test(String(jobId || "")) ? `https://www.linkedin.com/jobs/view/${jobId}` : "";
  }

  function meaningfulDescription(description, title) {
    const text = String(description || "").trim();
    return text.length >= 100 && text.length <= 100000 && text.toLowerCase() !== String(title || "").trim().toLowerCase();
  }

  function normalizedIdentity(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  async function acquireValidatedJobData(port, currentJobId, extracted) {
    const url = canonicalJobUrl(currentJobId);
    const deterministic = {
      title: String(extracted?.title || "").trim(),
      company: String(extracted?.company || "").trim(),
      description: String(extracted?.description || "").trim(),
      url,
    };
    const extractedId = jobIdFromValue(extracted?.url || extracted?.job_link);
    if (deterministic.title && deterministic.company && meaningfulDescription(deterministic.description, deterministic.title) && (!extractedId || extractedId === currentJobId)) {
      return deterministic;
    }

    const pageText = window.__resumeTrackerGetPageText?.();
    if (typeof pageText !== "string" || pageText.trim().length < 20) throw new Error("No focused job text was available for extraction");
    const parsed = await callApi(port, "/api/parse-job", { method: "POST", body: { text: pageText } });
    if (getCurrentJobId() !== currentJobId) throw new Error("Selected LinkedIn job changed during extraction");
    const title = String(parsed?.title || deterministic.title).trim();
    const company = String(parsed?.company || deterministic.company).trim();
    const description = String(parsed?.description || "").trim();
    if (!title || !company || !meaningfulDescription(description, title)) throw new Error("AI extraction did not return a complete job description");
    if (deterministic.title && normalizedIdentity(deterministic.title) !== normalizedIdentity(title)) throw new Error("AI extraction title did not match the selected LinkedIn job");
    if (deterministic.company && normalizedIdentity(deterministic.company) !== normalizedIdentity(company)) throw new Error("AI extraction company did not match the selected LinkedIn job");
    return { title, company, description, url };
  }

  async function prepareTailoredResume(port, runId, jobId) {
    const response = await callApi(port, `/api/linkedin-run/${runId}/tailor`, {
      method: "POST",
      body: { jobIds: [jobId] },
    });
    const result = response?.results?.find((entry) => Number(entry.jobId) === Number(jobId));
    if (!result?.success || result.status !== "ready" || result.tailoredArtifactExists !== true) {
      throw new Error(result?.error || "Tailored resume preparation did not complete");
    }
    const [job, artifact] = await Promise.all([
      callApi(port, `/api/jobs/${jobId}`),
      callApi(port, `/api/resume/tailored/${jobId}`),
    ]);
    if (job?.status !== "ready" || !job?.tailored_resume_path || !artifact?.exists || !artifact?.content) {
      throw new Error("Tailored resume artifact is missing or stale");
    }
    return true;
  }

  // ── Apply type detection ─────────────────────────────────────────────────

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function getJobDetailPanel() {
    const selectors = [
      ".jobs-search__job-details",
      ".jobs-search-two-pane__detail-view",
      "[class*='jobs-search-two-pane__detail']",
      ".scaffold-layout__detail",
    ];
    for (const selector of selectors) {
      const panel = document.querySelector(selector);
      if (panel) return panel;
    }
    return document.querySelector("main") || document;
  }

  function elementTextValues(element) {
    return [...new Set([element.innerText, element.textContent, element.getAttribute("aria-label"), element.title]
      .filter(Boolean)
      .map((value) => String(value).replace(/\s+/g, " ").trim())
      .filter(Boolean))];
  }

  function easyApplyText(element) {
    return elementTextValues(element).join(" ");
  }

  function isLinkedInEasyApplyControl(element) {
    const text = easyApplyText(element);
    const classSignalsEasyApply = Array.from(element.classList).some((name) => /easy.?apply/i.test(name));
    const linkedInBrandedApply = /\b(?:apply\s+linkedin|linkedin\s+apply)\b/i.test(text);
    return /\beasy\s+apply\b/i.test(text) || classSignalsEasyApply || linkedInBrandedApply;
  }

  function findEasyApplyButton(scope = getJobDetailPanel()) {
    return Array.from(scope.querySelectorAll("button, a, [role='button']"))
      .find((el) => {
        if (!isVisible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
        return isLinkedInEasyApplyControl(el);
      }) || null;
  }

  function findCurrentEasyApplyButton() {
    const detailPanel = getJobDetailPanel();
    return findEasyApplyButton(detailPanel) || (detailPanel !== document ? findEasyApplyButton(document) : null);
  }

  async function waitForEasyApplyButton(timeoutMs = 10_000) {
    try {
      return await waitFor(() => findCurrentEasyApplyButton(), timeoutMs, 250);
    } catch {
      return null;
    }
  }

  function findExternalApplyButton(scope = getJobDetailPanel()) {
    return Array.from(scope.querySelectorAll("button, a, [role='button']"))
      .find((el) => {
        if (!isVisible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
        const text = easyApplyText(el);
        return !isLinkedInEasyApplyControl(el) && /^(apply|apply now|apply on .+|continue application)\b/i.test(text);
      }) || null;
  }

  function findCurrentExternalApplyButton() {
    const detailPanel = getJobDetailPanel();
    return findExternalApplyButton(detailPanel) || (detailPanel !== document ? findExternalApplyButton(document) : null);
  }

  async function detectApplyType() {
    const startedAt = Date.now();
    let externalButton = null;
    while (Date.now() - startedAt < 12_000) {
      const easyApplyButton = findCurrentEasyApplyButton();
      if (easyApplyButton) {
        return { type: "easy_apply", label: easyApplyText(easyApplyButton), waitedMs: Date.now() - startedAt };
      }
      externalButton = findCurrentExternalApplyButton();
      // Do not accept an external button immediately: it may belong to the
      // previously selected job while LinkedIn is replacing the detail panel.
      if (externalButton && Date.now() - startedAt >= 6_000) {
        return { type: "external", label: easyApplyText(externalButton), waitedMs: Date.now() - startedAt };
      }
      await wait(250);
    }
    return {
      type: "external",
      label: externalButton ? easyApplyText(externalButton) : "No apply control detected",
      waitedMs: Date.now() - startedAt,
    };
  }

  // ── LinkedIn checkpoint / rate-limit detection ───────────────────────────

  function isVisibleCheckpointElement(element) {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const isOnScreen = (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
    const isChallengeSized = (
      element.tagName !== "IFRAME" ||
      (rect.width >= 250 && rect.height >= 70)
    );
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      isOnScreen &&
      isChallengeSized
    );
  }

  function detectCheckpoint() {
    const path = window.location.pathname;
    const isCheckpointPage = /\/(?:checkpoint|authwall)(?:\/|$)/i.test(path);
    const hasVerificationTitle = /security verification|verify your identity/i.test(document.title);
    const visibleChallenge = Array.from(document.querySelectorAll([
      "[data-test-id='checkpoint']",
      ".captcha-verification",
      "iframe[src*='recaptcha']",
      "iframe[src*='hcaptcha']",
    ].join(","))).some(isVisibleCheckpointElement);

    return isCheckpointPage || hasVerificationTitle || visibleChallenge;
  }

  function visibleDialogs() {
    return Array.from(document.querySelectorAll("[role='dialog'], .artdeco-modal"))
      .filter(isVisible);
  }

  function findActiveEasyApplyModal() {
    return Array.from(document.querySelectorAll([
      '[role="dialog"].jobs-easy-apply-modal',
      '[role="dialog"][aria-label*="apply" i]',
      '.jobs-easy-apply-modal',
      '[data-test-modal="easy-apply"]',
    ].join(","))).find(isVisible) || null;
  }

  function findVisibleButton(scope, pattern) {
    return Array.from(scope.querySelectorAll("button, [role='button']"))
      .find((button) => isVisible(button) && !button.disabled && elementTextValues(button).some((text) => pattern.test(text))) || null;
  }

  function submissionIsConfirmed() {
    const detailButton = Array.from(getJobDetailPanel().querySelectorAll("button, [role='button']"))
      .find((button) => isVisible(button) && elementTextValues(button).some((text) => /^applied(?: to\b.*)?$/i.test(text)));
    if (detailButton) return true;

    return Array.from(document.querySelectorAll("[role='dialog'], [role='alert'], .artdeco-toast-item, .artdeco-modal"))
      .filter(isVisible)
      .some((element) => /application (?:was )?(?:sent|submitted)|successfully applied|your application was sent/i.test(element.textContent || ""));
  }

  function saveApplicationDialog() {
    return visibleDialogs().find((dialog) => /save (?:this )?application|discard (?:this )?application|unsaved/i.test(dialog.textContent || "")) || null;
  }

  async function waitForSubmissionResult(modal, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let closedAt = 0;
    while (Date.now() < deadline) {
      if (submissionIsConfirmed()) return true;
      const applicationOpen = document.contains(modal) && isVisible(modal);
      const discardOpen = Boolean(saveApplicationDialog());
      if (!applicationOpen && !discardOpen) {
        if (!closedAt) closedAt = Date.now();
        if (Date.now() - closedAt >= 2_000) return false;
      } else {
        closedAt = 0;
      }
      await wait(400);
    }
    return false;
  }

  async function closeEasyApplyDialogs(modal, submitted) {
    if (submitted) {
      const successDialog = visibleDialogs().find((dialog) =>
        /application (?:was )?(?:sent|submitted)|successfully applied|your application was sent/i.test(dialog.textContent || "")
      );
      const doneButton = successDialog && (
        findVisibleButton(successDialog, /^(done|dismiss|close)$/i) ||
        successDialog.querySelector("button[aria-label*='Dismiss' i], button[data-test-modal-close-btn]")
      );
      doneButton?.click();
    } else if (document.contains(modal) && isVisible(modal)) {
      const closeButton = modal.querySelector("button[aria-label*='Dismiss' i], button[data-test-modal-close-btn], button[aria-label*='Close' i]");
      closeButton?.click();
      await wait(500);

      const saveDialog = saveApplicationDialog();
      const discardButton = saveDialog && findVisibleButton(saveDialog, /^(discard|exit|leave|don't save|do not save)( application)?$/i);
      discardButton?.click();
    }

    try {
      await waitFor(() => {
        const applicationStillOpen = document.contains(modal) && isVisible(modal);
        return !applicationStillOpen && !saveApplicationDialog();
      }, 6_000, 250);
    } catch {
      console.warn("[ResumeTracker] Easy Apply dialog did not close cleanly");
    }
  }

  async function markJobApplied(port, jobId) {
    try {
      await callApi(port, `/api/jobs/${jobId}`, {
        method: "PATCH",
        body: { status: "applied" },
      });
    } catch { /* non-fatal */ }
  }

  async function waitForUserResume(port, runId, jobId, state, detail = "") {
    document.getElementById("rt-auto-progress")?.remove();
    const reason = state.replace(/^paused-/, "").replaceAll("-", " ");
    showMsg("Personal confirmation required", detail || `Complete the ${reason} step in LinkedIn, then click Resume automation.`);
    const resumeButton = ensurePanel().querySelector("#rt-run-resume");
    resumeButton.style.display = "block";

    try {
      await callApi(port, `/api/linkedin-run/${runId}`, {
        method: "PATCH",
        body: { note: `Waiting for your ${reason} confirmation — click Resume automation in LinkedIn when complete.` },
      });
    } catch { /* status note is non-fatal */ }

    return new Promise((resolve) => {
      let settled = false;
      let closedAt = 0;
      const finish = (decision) => {
        if (settled) return;
        settled = true;
        clearInterval(pollId);
        hideResumeButton();
        resolve(decision);
      };

      resumeButton.onclick = async () => {
        resumeButton.disabled = true;
        resumeButton.textContent = "Saving answers…";
        showMsg("Learning your answers…", "Saving reusable answers before automation continues.");
        try {
          const activeModal = findActiveEasyApplyModal();
          const learned = await window.__rtAutoFill?.captureAnsweredQuestions?.(port, jobId, { fillRoot: activeModal });
          const count = Number(learned?.saved || 0) + Number(learned?.updated || 0);
          showMsg("Answers saved", count > 0 ? `Learned ${count} answer${count === 1 ? "" : "s"}. Resuming…` : "No new reusable answers found. Resuming…");
        } catch (error) {
          console.warn("[ResumeTracker] Could not learn completed answers:", error);
          showMsg("Resuming Easy Apply…", "Answer learning failed, but automation can continue.");
        } finally {
          resumeButton.disabled = false;
          resumeButton.textContent = "Resume automation";
          finish("resume");
        }
      };
      const pollId = setInterval(() => {
        if (stopRequested) { finish("stopped"); return; }
        if (submissionIsConfirmed()) { finish("submitted"); return; }
        const activeModal = findActiveEasyApplyModal();
        if (!activeModal && !saveApplicationDialog()) {
          if (!closedAt) closedAt = Date.now();
          if (Date.now() - closedAt >= 2_000) finish("closed");
        } else {
          closedAt = 0;
        }
      }, 500);
    });
  }

  // ── Easy Apply modal driver ───────────────────────────────────────────────

  async function driveEasyApply(port, runId, jobId, autoSubmit) {
    const eaBtn = await waitForEasyApplyButton(12_000);
    if (!eaBtn) return { ok: false, note: "Easy Apply button not found" };
    eaBtn.click();

    let modal = null;
    try {
      modal = await waitFor(() => findActiveEasyApplyModal(), 8_000);
    } catch {
      return { ok: false, note: "Easy Apply modal did not open" };
    }

    try {
      await callApi(port, `/api/linkedin-run/${runId}`, {
        method: "PATCH",
        body: { note: `Easy Apply modal opened for job ${jobId}` },
      });
    } catch { /* diagnostic note is non-fatal */ }

    let submitted = false;
    let leaveOpenForReview = false;
    try {
      if (!window.__rtAutoFill?.autoApply) {
        return { ok: false, note: "Autofill controller not loaded" };
      }

      let baseSettings = null;
      try { baseSettings = await callApi(port, "/api/application-settings"); } catch { /* use defaults */ }
      const runSettings = Object.assign({}, baseSettings || {
        auto_continue: true, wait_seconds: 3, pause_on_unknown: true, resume_format: "docx",
      }, {
        auto_continue: true,
        final_review: !autoSubmit,
        strict_auto_run: true,
        require_tailored_resume: true,
      });

      while (!stopRequested) {
        modal = findActiveEasyApplyModal() || modal;
        window.__rtAutoFill.setFillRoot(modal);
        const result = await window.__rtAutoFill.autoApply(port, jobId, {
          fillRoot: modal,
          settings: runSettings,
        });

        const submitClicked = result?.automation?.state === "submitted";
        const pausedForReview = result?.automation?.state === "final-review";

        if (submitClicked) {
          submitted = await waitForSubmissionResult(modal, 20_000);
          if (!submitted) return { ok: false, note: "Submit was clicked, but LinkedIn did not confirm the application" };
          await markJobApplied(port, jobId);
          return { ok: true, submitted: true, note: "Applied via Easy Apply" };
        }

        if (pausedForReview) {
          showMsg("Review and submit this application in LinkedIn", "The run will continue after LinkedIn confirms submission.");
          submitted = await waitForSubmissionResult(modal, 5 * 60_000);
          if (!submitted) return { ok: false, note: "Final review closed or timed out without submission confirmation" };
          await markJobApplied(port, jobId);
          return { ok: true, submitted: true, note: "Applied via Easy Apply (manual review)" };
        }

        const state = result?.automation?.state || "unknown";
        if (!/^paused-/.test(state)) return { ok: false, note: `Autofill stopped: ${state}` };

        window.__rtAutoFill.setFillRoot(null);
        const pauseDetail = String(result?.automation?.reason || "");
        const decision = await waitForUserResume(port, runId, jobId, state, pauseDetail);
        if (decision === "submitted") {
          submitted = true;
          await markJobApplied(port, jobId);
          return { ok: true, submitted: true, note: "Applied via Easy Apply after personal confirmation" };
        }
        if (decision === "resume") {
          modal = findActiveEasyApplyModal() || modal;
          try {
            await callApi(port, `/api/linkedin-run/${runId}`, {
              method: "PATCH",
              body: { note: "Resuming Easy Apply automation…" },
            });
          } catch { /* status note is non-fatal */ }
          showMsg("Resuming Easy Apply…", "Checking the current LinkedIn step again.");
          continue;
        }

        leaveOpenForReview = decision === "stopped";
        return {
          ok: false,
          paused: decision === "stopped",
          note: decision === "stopped"
            ? `Stopped while waiting for personal confirmation${pauseDetail ? `: ${pauseDetail}` : ""}`
            : `Easy Apply form closed before automation resumed${pauseDetail ? `: ${pauseDetail}` : ""}`,
        };
      }
      leaveOpenForReview = true;
      return { ok: false, paused: true, note: "Stopped while waiting for personal confirmation" };
    } finally {
      window.__rtAutoFill.setFillRoot(null);
      hideResumeButton();
      if (!leaveOpenForReview) await closeEasyApplyDialogs(modal, submitted);
    }
  }

  // ── Main crawl loop ───────────────────────────────────────────────────────

  async function runCrawl(port, run) {
    const runId = run.id;
    const maxJobs = run.max_jobs;
    const autoSubmit = Boolean(run.auto_submit);

    // Mark running
    try { await callApi(port, `/api/linkedin-run/${runId}`, { method: "PATCH", body: { status: "running" } }); } catch { /* non-fatal */ }

    let savedItems = [];
    try {
      const state = await callApi(port, `/api/linkedin-run/${runId}`);
      savedItems = Array.isArray(state?.items) ? state.items : [];
    } catch { /* start with the run payload when state cannot be reloaded */ }
    const processedJobIds = new Set(savedItems.map((item) => jobIdFromValue(item.url)).filter(Boolean));
    let totalProcessed = savedItems.length;
    const remainingAllowance = Math.max(0, maxJobs - totalProcessed);
    if (remainingAllowance === 0) {
      await callApi(port, `/api/linkedin-run/${runId}`, { method: "PATCH", body: { status: "done", note: "" } });
      showMsg("Run complete — job cap already reached.", "Check the dashboard for results.");
      return;
    }

    showMsg("Collecting job cards…", `${totalProcessed} / ${maxJobs} jobs`);
    const targets = await collectJobTargets(maxJobs);
    showMsg(`Found ${targets.length} job cards`, "Starting…");

    for (const target of targets) {
      if (stopRequested) break;
      if (totalProcessed >= maxJobs) break;
      if (detectCheckpoint()) {
        await callApi(port, `/api/linkedin-run/${runId}`, {
          method: "PATCH",
          body: { status: "stopped", note: "LinkedIn checkpoint / CAPTCHA detected — please verify manually then restart." },
        });
        showMsg("Checkpoint detected. Stopped.", "Complete the verification in the LinkedIn tab then re-run.");
        return;
      }

      const card = await findCardForJob(target.jobId);
      if (!card) {
        showMsg(`Could not reopen LinkedIn job ${target.jobId}`, "Skipping stale result card.");
        continue;
      }

      const prevJobId = getCurrentJobId();
      const previousDetailSignature = getDetailSignature();
      clickCard(card);
      try {
        await waitForDetailPanel(prevJobId, target.jobId, previousDetailSignature);
      } catch {
        showMsg(`LinkedIn job ${target.jobId} did not open`, "Skipping after the detail panel timed out.");
        continue;
      }

      const currentJobId = getCurrentJobId() || target.jobId;
      if (!currentJobId || processedJobIds.has(currentJobId)) continue;
      processedJobIds.add(currentJobId);

      showMsg(`Processing job ${totalProcessed + 1} / ${maxJobs}`, "Extracting job details…");

      // Extract job details deterministically, then use the configured routine
      // provider only when LinkedIn omitted required fields.
      let jobData = null;
      try {
        if (window.__resumeTrackerExtractAsync) {
          jobData = await window.__resumeTrackerExtractAsync(10, 400);
        }
      } catch { /* extraction failed */ }

      try {
        jobData = await acquireValidatedJobData(port, currentJobId, jobData);
      } catch (error) {
        const failureUrl = canonicalJobUrl(currentJobId);
        await callApi(port, `/api/linkedin-run/${runId}`, {
          method: "PATCH",
          body: { item: {
            jobId: null,
            title: String(jobData?.title || `LinkedIn job ${currentJobId}`),
            company: String(jobData?.company || "Unknown company"),
            url: failureUrl,
            applyType: "easy_apply",
            outcome: "failed",
            note: `Job extraction failed: ${error instanceof Error ? error.message : String(error)}`,
          } },
        });
        totalProcessed++;
        showMsg(`Job ${totalProcessed}: extraction failed, skipping`, "");
        await jitter(1_500, 3_000);
        continue;
      }

      const extractedJobId = jobIdFromValue(jobData.url || jobData.job_link);
      if (extractedJobId && extractedJobId !== currentJobId) {
        showMsg(`Job ${totalProcessed + 1}: LinkedIn detail mismatch`, `Expected ${currentJobId}, received ${extractedJobId}.`);
        await jitter(1_000, 2_000);
        continue;
      }

      // Wait for LinkedIn's asynchronously rendered apply controls before classifying.
      const detection = await detectApplyType();
      const applyType = detection.type;
      console.info("[ResumeTracker] LinkedIn apply control detected", {
        linkedInJobId: currentJobId,
        applyType,
        label: detection.label,
        waitedMs: detection.waitedMs,
      });

      // Import to DB and get jobId
      let dbJobId = null;
      try {
        const importResp = await callApi(port, `/api/linkedin-run/${runId}/job`, {
          method: "POST",
          body: {
            company: jobData.company,
            title: jobData.title,
            description: jobData.description || jobData.title,
            job_link: canonicalJobUrl(currentJobId),
            linkedInJobId: currentJobId,
            apply_type: applyType,
          },
        });
        dbJobId = importResp?.jobId;
        if (importResp?.jobStatus === "applied") {
          totalProcessed++;
          await callApi(port, `/api/linkedin-run/${runId}`, {
            method: "PATCH",
            body: { item: {
              jobId: dbJobId, title: jobData.title, company: jobData.company,
              url: jobData.url, applyType, outcome: "skipped",
              note: "Skipped because this tracked job is already marked applied",
            } },
          });
          showMsg(`${jobData.company} — already applied`, `${totalProcessed} / ${maxJobs}`);
          continue;
        }
      } catch (err) {
        showMsg(`Job ${totalProcessed + 1}: import failed`, String(err).slice(0, 80));
        await jitter(1_500, 3_000);
        continue;
      }

      totalProcessed++;

      if (applyType === "external") {
        // Tailor-and-flag: start tailoring, record outcome
        showMsg(`${jobData.company} — ${jobData.title}`, "External portal — tailoring resume…");
        let preparationError = null;
        try { await prepareTailoredResume(port, runId, dbJobId); }
        catch (error) { preparationError = error instanceof Error ? error.message : String(error); }
        await callApi(port, `/api/linkedin-run/${runId}`, {
          method: "PATCH",
          body: {
            item: {
              jobId: dbJobId, title: jobData.title, company: jobData.company,
              url: jobData.url || "", applyType: "external",
              outcome: preparationError ? "failed" : "needs_manual",
              note: preparationError
                ? `External portal preparation failed: ${preparationError}`
                : `External portal — detected "${detection.label}" after ${Math.round(detection.waitedMs / 100) / 10}s; tailored resume ready, apply via dashboard`,
            },
          },
        });
        showMsg(preparationError ? `${jobData.company} — preparation failed` : `${jobData.company} — flagged for manual apply`, `${totalProcessed} / ${maxJobs}`);
      } else {
        // Easy Apply flow
        showMsg(`${jobData.company} — ${jobData.title}`, "Tailoring resume…");
        let preparationError = null;
        try {
          await prepareTailoredResume(port, runId, dbJobId);
        } catch (error) {
          preparationError = error instanceof Error ? error.message : String(error);
        }

        if (preparationError) {
          await callApi(port, `/api/linkedin-run/${runId}`, {
            method: "PATCH",
            body: { item: {
              jobId: dbJobId, title: jobData.title, company: jobData.company,
              url: jobData.url, applyType: "easy_apply", outcome: "failed",
              note: `Tailored resume preparation failed: ${preparationError}`,
            } },
          });
          showMsg(`⚠ ${jobData.company}: tailoring failed`, `${totalProcessed} / ${maxJobs}`);
          await jitter(3_000, 8_000);
          continue;
        }

        // Drive Easy Apply
        showMsg(`${jobData.company} — applying via Easy Apply…`, "");
        const applyResult = await driveEasyApply(port, runId, dbJobId, autoSubmit);

        const outcome = applyResult.submitted ? "applied" : applyResult.paused ? "needs_manual" : "failed";
        await callApi(port, `/api/linkedin-run/${runId}`, {
          method: "PATCH",
          body: {
            item: {
              jobId: dbJobId, title: jobData.title, company: jobData.company,
              url: jobData.url || "", applyType: "easy_apply",
              outcome, note: applyResult.note || "",
            },
          },
        });

        if (applyResult.submitted) {
          showMsg(`✓ Applied to ${jobData.company}`, `${totalProcessed} / ${maxJobs}`);
        } else if (applyResult.paused) {
          await callApi(port, `/api/linkedin-run/${runId}`, {
            method: "PATCH",
            body: { status: "stopped", note: `${jobData.company}: ${applyResult.note}` },
          });
          showMsg(`Review needed for ${jobData.company}`, "The run stopped with the Easy Apply form left open.");
          return;
        } else {
          showMsg(`⚠ ${jobData.company}: ${applyResult.note}`, `${totalProcessed} / ${maxJobs}`);
        }
      }

      // Human-like gap between jobs
      await jitter(3_000, 8_000);
    }

    // Finalize run
    const finalStatus = stopRequested ? "stopped" : "done";
    try {
      await callApi(port, `/api/linkedin-run/${runId}`, {
        method: "PATCH",
        body: { status: finalStatus, note: "" },
      });
    } catch { /* non-fatal */ }

    showMsg(
      stopRequested ? "Run stopped." : `Run complete — ${totalProcessed} jobs processed.`,
      "Check the dashboard for results."
    );
    setTimeout(() => removePanel(), 12_000);
    window.__rtLinkedInRunActive = false;
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  async function start() {
    const { savedPort } = await chrome.storage.local.get("savedPort");
    const port = parseInt(savedPort || "3000", 10);

    let run = null;
    try {
      const resp = await callApi(port, "/api/linkedin-run/active");
      run = resp?.run;
    } catch (err) {
      console.warn("[ResumeTracker] Could not fetch active run:", err.message);
      window.__rtLinkedInRunActive = false;
      return;
    }

    if (!run) { window.__rtLinkedInRunActive = false; return; }

    // Verify we're on the expected search URL
    if (!window.location.href.includes("linkedin.com/jobs/search")) {
      window.__rtLinkedInRunActive = false;
      return;
    }

    ensurePanel();
    showMsg("LinkedIn run starting…", `"${run.keywords}"${run.location ? ` · ${run.location}` : ""}`);

    try {
      await runCrawl(port, run);
    } catch (err) {
      showMsg("Run error: " + err.message, "Check the dashboard.");
      try {
        await callApi(port, `/api/linkedin-run/${run.id}`, {
          method: "PATCH",
          body: { status: "failed", note: err.message },
        });
      } catch { /* ignore */ }
      window.__rtLinkedInRunActive = false;
    }
  }

  if (window.__RT_LINKEDIN_RUN_TEST__) {
    window.__rtLinkedInRunTest = {
      waitFor,
      jobIdFromValue,
      easyApplyText,
      findEasyApplyButton,
      findExternalApplyButton,
      canonicalJobUrl,
      meaningfulDescription,
    };
    window.__rtLinkedInRunActive = false;
    return;
  }

  // Delay slightly so content.js (injected in the same batch) can register its globals first.
  setTimeout(start, 800);
})();
