const $ = (id) => document.getElementById(id);
let activePopupTabId = null;

// ── Tabs ──────────────────────────────────────────────────────────────────

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`panel-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "autofill") initAutoFillTab();
  });
});

// ── Status helpers ────────────────────────────────────────────────────────

function showStatus(msg, type, elId = "status") {
  const el = $(elId);
  el.textContent = msg;
  el.className = type;
  el.style.display = "block";
}

function hideStatus(elId = "status") {
  $(elId).style.display = "none";
}

const RESUME_UPLOAD_STAGE_LABELS = {
  preparing: "preparing",
  fetching_profile: "loading profile",
  fetching_tailored: "loading tailored résumé",
  generating_document: "generating résumé",
  starting_download: "starting download",
  waiting_for_download: "waiting for download",
  downloaded: "download complete",
  attaching_debugger: "attaching debugger",
  debugger_attached: "debugger attached",
  enabling_chooser: "arming file chooser",
  resolving_target: "finding Upload control",
  clicking_upload: "opening file chooser",
  file_set_pending: "assigning file",
  file_set: "checking LinkedIn",
  validating: "checking LinkedIn",
  validated: "validated",
  needs_manual: "manual review",
};

function uploadStageLabel(stage) {
  return RESUME_UPLOAD_STAGE_LABELS[stage] || String(stage || "unknown").replaceAll("_", " ");
}

function showResumeUploadStatus(status) {
  const clearBtn = $("clear-upload-pause-btn");
  if (!status) {
    if (clearBtn) clearBtn.style.display = "none";
    return;
  }
  const failedStage = status.failedStage || status.failure?.stage || status.stage;
  if (status.stage === "validated") {
    showStatus(`Résumé validated: ${status.filename || "selected file"}.`, "success", "autofill-status");
  } else if (status.stage === "needs_manual") {
    showStatus(`Résumé upload paused at ${uploadStageLabel(failedStage)}: ${status.failure?.message || "Review LinkedIn manually. The file will not be uploaded again."}`, "error", "autofill-status");
  } else {
    showStatus(`Résumé upload: ${uploadStageLabel(status.stage)}…`, "info", "autofill-status");
  }
  if (clearBtn) {
    const stale = Date.now() - Number(status.updatedAt || 0) > 80_000;
    const safeToClear = !status.fileSet && !status.ambiguous && status.stage !== "validated" && (status.terminal || stale);
    clearBtn.style.display = safeToClear ? "block" : "none";
  }
}

async function refreshResumeUploadStatus(tabId) {
  if (!tabId) return;
  const response = await chrome.runtime.sendMessage({ type: "GET_RESUME_UPLOAD_STATUS", tabId }).catch(() => null);
  if (response?.ok) showResumeUploadStatus(response.status);
}

function getPort() {
  const v = parseInt($("port").value, 10);
  return isNaN(v) || v < 1 ? 3000 : v;
}

async function checkPortConnection() {
  const status = $("port-status");
  if (!status) return;
  status.textContent = "Checking…";
  status.style.color = "#64748b";
  try {
    const response = await fetch(`http://localhost:${getPort()}/api/profile`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    status.textContent = "Connected";
    status.style.color = "#63cab7";
  } catch {
    status.textContent = "Unavailable";
    status.style.color = "#f87171";
  }
}

// ── AI fallback toggle (Import tab) ──────────────────────────────────────

function setupAiToggle() {
  $("ai-toggle").addEventListener("click", () => {
    const body = $("ai-body");
    const chevron = $("ai-chevron");
    const isOpen = body.classList.contains("open");
    body.classList.toggle("open", !isOpen);
    chevron.classList.toggle("open", !isOpen);
  });
}

function openAiFallback() {
  $("ai-body").classList.add("open");
  $("ai-chevron").classList.add("open");
}

function missingFields() {
  const out = [];
  if (!$("company").value.trim())     out.push("company");
  if (!$("title").value.trim())       out.push("title");
  if (!$("description").value.trim()) out.push("description");
  return out;
}

// ── Selector persistence helpers ──────────────────────────────────────────

function selectorStorageKey(pageType) {
  // Version the cache whenever extraction rules change so a selector learned
  // from an older LinkedIn layout cannot keep returning a wrong designation.
  return `learnedSelectors_v3_${pageType}`;
}

async function learnAndSaveSelectors(tabId, aiData) {
  try {
    const [{ result: learned }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (data) => window.__resumeTrackerLearnSelectors?.(data) ?? null,
      args: [aiData],
    });

    if (learned && learned._pageType) {
      const key = selectorStorageKey(learned._pageType);
      await chrome.storage.local.set({ [key]: learned });
    }
  } catch (e) {
    console.warn("[ResumeTracker] Could not learn selectors:", e.message);
  }
}

async function injectLearnedSelectors(tabId, url) {
  try {
    const pageType = /\/jobs\/view\//.test(url) ? "detail" : "search";
    const key = selectorStorageKey(pageType);
    const stored = await chrome.storage.local.get(key);
    const learned = stored[key] || null;

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => { window.__resumeTrackerLearnedSelectors = sel; },
      args: [learned],
    });
  } catch (e) {
    console.warn("[ResumeTracker] Could not inject learned selectors:", e.message);
  }
}

// ── Auto-fill tab ─────────────────────────────────────────────────────────

async function initAutoFillTab() {
  const port = getPort();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activePopupTabId = tab?.id || null;

  // Show page context
  const statusEl = $("autofill-page-status");
  const isAppPage = tab?.url?.includes(`localhost:${port}`);
  const isJobAppPage = tab?.url && /apply|application|careers|linkedin\.com\/jobs\/(view|search-results)|greenhouse\.io|lever\.co|workday\.com|ashbyhq\.com|icims\.com|taleo\.net/i.test(tab.url);

  statusEl.innerHTML = "";
  const badge = document.createElement("div");
  badge.className = `autofill-page-badge ${isJobAppPage ? "app-page" : isAppPage ? "other-page" : "unknown-page"}`;

  if (isJobAppPage) {
    badge.innerHTML = `<span>✓</span> Application page detected — click Auto Apply`;
    badge.title = tab.url;
  } else if (isAppPage) {
    badge.innerHTML = `<span>ℹ</span> Resume Tracker app`;
  } else {
    badge.innerHTML = `<span>–</span> Navigate to a job application to auto apply`;
  }
  statusEl.appendChild(badge);

  // Detect active job from URL hash or storage
  let jobId = null;
  if (tab?.url) {
    const hashMatch = tab.url.match(/rt_job_id=(\d+)/);
    if (hashMatch) jobId = parseInt(hashMatch[1], 10);
  }
  if (!jobId) {
    const stored = await chrome.storage.local.get("activeJobId");
    jobId = stored.activeJobId || null;
  }

  const jobBadge = $("active-job-badge");
  const markBtn = $("mark-applied-btn");
  if (jobId) {
    jobBadge.style.display = "block";
    jobBadge.innerHTML = `<span>✓</span> Job #${jobId} — tailored resume will be used`;
    markBtn.style.display = "block";
    markBtn.dataset.jobId = String(jobId);
  } else {
    jobBadge.style.display = "none";
    markBtn.style.display = "none";
  }

  await refreshResumeUploadStatus(tab?.id);

  // Load profile preview
  try {
    const res = await fetch(`http://localhost:${port}/api/profile`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const profile = await res.json();
    renderProfilePreview(profile);
  } catch {
    $("profile-preview").innerHTML = `<div class="pf-empty">App not running on port ${port}. Start the app first.</div>`;
  }
}

function renderProfilePreview(profile) {
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  const lines = [];
  if (name) lines.push(`<div class="pf-name">${esc(name)}</div>`);
  if (profile.email) lines.push(esc(profile.email));
  if (profile.phone) lines.push(esc(profile.phone));
  if (profile.current_title) lines.push(esc(profile.current_title) + (profile.current_company ? ` @ ${esc(profile.current_company)}` : ""));
  if (profile.location) lines.push(esc(profile.location));

  if (lines.length === 0) {
    $("profile-preview").innerHTML = `<div class="pf-empty">No profile data yet. <a href="#" id="go-profile-link" style="color:#818cf8">Set it up in the app.</a></div>`;
    document.getElementById("go-profile-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: `http://localhost:${getPort()}/profile` });
    });
  } else {
    $("profile-preview").innerHTML = lines.join("<br>");
  }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const AUTO_FILL_CONTROLLER_VERSION = "3.6.1";

async function controllerStates(tabId) {
  const executions = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => ({
      ready: Boolean(window.__rtAutoFill?.autoApply && window.__rtAutoFill?.fillPage),
      version: window.__rtAutoFill?.version || null,
      loadedFlag: Boolean(window.__resumeTrackerAutoFillLoaded),
      readyState: document.readyState,
      hasActiveApplicationDialog: Array.from(document.querySelectorAll(".jobs-easy-apply-modal, [role='dialog']")).some((candidate) => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        const text = String(candidate.innerText || "").replace(/\s+/g, " ").trim();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 &&
          (candidate.matches(".jobs-easy-apply-modal") || /(?:easy apply|apply to|application)/i.test(text));
      }),
    }),
  });
  return executions.map(({ frameId, result }) => ({
    frameId,
    ...(result || { ready: false, version: null, loadedFlag: false, readyState: "unknown", hasActiveApplicationDialog: false }),
  }));
}

function preferredControllerState(states) {
  return states.find((state) => state.ready && state.version === AUTO_FILL_CONTROLLER_VERSION && state.hasActiveApplicationDialog)
    || states.find((state) => state.ready && state.version === AUTO_FILL_CONTROLLER_VERSION && state.frameId === 0)
    || states.find((state) => state.ready && state.version === AUTO_FILL_CONTROLLER_VERSION)
    || null;
}

async function ensureAutoFillController(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content-autofill.js"] });
  let states = await controllerStates(tabId);
  let state = preferredControllerState(states);
  if (state) return state;

  // Recover frames left with an old script's loaded flag but no controller.
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      window.__resumeTrackerAutoFillLoaded = false;
      delete window.__rtAutoFill;
      document.getElementById("rt-fab")?.remove();
    },
  });
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content-autofill.js"] });
  states = await controllerStates(tabId);
  state = preferredControllerState(states);
  if (!state) {
    const fallback = states[0] || { readyState: "unknown", loadedFlag: false };
    throw new Error(`Autofill controller ${AUTO_FILL_CONTROLLER_VERSION} did not start in the application frame (page: ${fallback.readyState}, loaded flag: ${fallback.loadedFlag ? "yes" : "no"}). Refresh this LinkedIn tab once, then retry.`);
  }
  return state;
}

async function invokeAutoFill(tabId, frameId, method, args) {
  const execution = chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: async (methodName, methodArgs) => {
      const controller = window.__rtAutoFill;
      const fn = controller?.[methodName];
      if (typeof fn !== "function") return { ok: false, error: `Autofill method ${methodName} is unavailable.` };
      try {
        return { ok: true, data: await fn(...methodArgs), version: controller.version || null };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), version: controller.version || null };
      }
    },
    args: [method, args],
  });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(
    "Autofill exceeded its safety deadline. If a résumé upload was in progress, do not retry it; review LinkedIn and the saved upload status.",
  )), 90_000));
  const [{ result }] = await Promise.race([execution, timeout]);
  if (!result?.ok) throw new Error(result?.error || "The autofill controller returned no result.");
  return result.data;
}

function linkedInPostingIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    return url.pathname.match(/\/jobs\/view\/(\d+)/i)?.[1]
      || (/^\d+$/.test(url.searchParams.get("currentJobId") || "") ? url.searchParams.get("currentJobId") : null);
  } catch {
    return null;
  }
}

async function uploadLinkedInResumeFromPopup({ tabId, tabUrl, port, jobId }) {
  let format = "docx";
  try {
    const settingsResponse = await fetch(`http://localhost:${port}/api/application-settings`);
    if (settingsResponse.ok) {
      const settings = await settingsResponse.json();
      format = settings?.resume_format === "pdf" ? "pdf" : "docx";
    }
  } catch {
    // DOCX remains the safe default.
  }
  const linkedInJobId = linkedInPostingIdFromUrl(tabUrl);
  if (!linkedInJobId) return null;
  return chrome.runtime.sendMessage({
    type: "UPLOAD_RESUME_VIA_CDP",
    tabId,
    port,
    jobId,
    format,
    linkedInJobId,
    attemptId: `rt_popup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2).padEnd(20, "0")}`,
  });
}

// ── Auto Apply ────────────────────────────────────────────────────────────

async function runAutoApply(fieldsOnly = false) {
  const port = getPort();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const btn = fieldsOnly ? $("fill-fields-btn") : $("fill-btn");
  btn.disabled = true;
  showStatus(fieldsOnly ? "Filling form fields…" : "Auto applying…", "info", "autofill-status");

  try {
    let jobId = null;
    if (tab.url) {
      const hashMatch = tab.url.match(/rt_job_id=(\d+)/);
      if (hashMatch) jobId = parseInt(hashMatch[1], 10);
    }
    if (!jobId) {
      const stored = await chrome.storage.local.get("activeJobId");
      jobId = stored.activeJobId || null;
    }

    if (!fieldsOnly && jobId && tab.url) {
      const upload = await uploadLinkedInResumeFromPopup({ tabId: tab.id, tabUrl: tab.url, port, jobId });
      if (upload?.ok) {
        showStatus(`${String(upload.filename || "Résumé")} uploaded and selected in LinkedIn. Review the application before continuing; submission is still manual.`, "success", "autofill-status");
        await refreshResumeUploadStatus(tab.id);
        return;
      }
      if (upload && !(upload.failure?.reason === "input_not_found" && upload.stage === "accessibility_target")) {
        showStatus(`Résumé upload paused at ${uploadStageLabel(upload.stage || "unknown")}: ${upload.failure?.message || "Review LinkedIn manually. The file will not be uploaded again."}`, "error", "autofill-status");
        await refreshResumeUploadStatus(tab.id);
        return;
      }
    }

    const controller = await ensureAutoFillController(tab.id);

    if (fieldsOnly) {
      const profileRes = await fetch(`http://localhost:${port}/api/profile`);
      if (!profileRes.ok) throw new Error(`App not responding on port ${port}`);
      const profile = await profileRes.json();

      const result = await invokeAutoFill(tab.id, controller.frameId, "fillPage", [profile]);

      if (!result || result.filled === 0) {
        showStatus("No matching fields found on this page.", "warning", "autofill-status");
      } else {
        showStatus(`Filled ${result.filled} field${result.filled === 1 ? "" : "s"}.`, "success", "autofill-status");
      }
      return;
    }

    // This explicit user-initiated automation session also watches later Easy
    // Apply steps for a rendered resume field. It never advances the form by
    // itself; autoApply remains responsible for that when configured.
    if (jobId) await invokeAutoFill(tab.id, controller.frameId, "armResumeUpload", [port, jobId]);
    const result = await invokeAutoFill(tab.id, controller.frameId, "autoApply", [port, jobId]);

    if (!result) {
      showStatus("Autofill returned no result. Refresh this LinkedIn tab once, then retry.", "error", "autofill-status");
      return;
    }

    if (result.resumeUploadFailure || result.automation?.state === "needs_manual") {
      const uploadFailure = result.resumeUploadFailure || result.automation?.failure || {};
      const stage = uploadFailure.stage || result.resumeUploadResult?.stage || "validation";
      showStatus(`Résumé upload paused at ${uploadStageLabel(stage)}: ${uploadFailure.message || result.resumeUploadError || result.automation?.reason || "Review LinkedIn manually. The file will not be uploaded again."}`, "error", "autofill-status");
      await refreshResumeUploadStatus(tab.id);
      return;
    }

    const parts = [];
    if (result.filled > 0) parts.push(`${result.filled} field${result.filled === 1 ? "" : "s"}`);
    if (result.resumeUploaded > 0) parts.push(`${String(result.resumeFormat || "docx").toUpperCase()} resume uploaded`);
    if (result.coverLetterFilled > 0) parts.push("cover letter");
    if (result.aiQuestionsFilled > 0) parts.push(`${result.aiQuestionsFilled} AI answer${result.aiQuestionsFilled === 1 ? "" : "s"}`);

    if (parts.length === 0) {
      const reason = result.aiError ? ` ${result.aiError}` : "";
      showStatus(`No matching fields found. Review the form manually.${reason}`, "warning", "autofill-status");
    } else {
      const review = result.questionsUnanswered > 0
        ? ` ${result.questionsUnanswered} question${result.questionsUnanswered === 1 ? " needs" : "s need"} your review.`
        : "";
      const aiWarning = result.aiError ? ` AI answers were unavailable: ${result.aiError}` : "";
      const automationText = result.automation?.state === "final-review"
          ? " Final review is on, so submission is waiting for you."
          : result.automation?.state === "next"
            ? " Continued to the next application step."
            : result.automation?.state?.startsWith("paused")
              ? " Automation paused for your input."
              : " Review the page before continuing.";
      showStatus(`Filled: ${parts.join(", ")}.${review}${aiWarning}${automationText}`, result.aiError ? "warning" : "success", "autofill-status");
      if (result.jobId) {
        $("mark-applied-btn").style.display = "block";
        $("mark-applied-btn").dataset.jobId = String(result.jobId);
      }
    }
  } catch (err) {
    const isFetch = err.message.includes("Failed to fetch");
    showStatus(
      isFetch ? `App not running on port ${port}. Start the app first.` : err.message,
      "error", "autofill-status"
    );
  } finally {
    btn.disabled = false;
  }
}

$("fill-btn").addEventListener("click", () => runAutoApply(false));
$("fill-fields-btn").addEventListener("click", () => runAutoApply(true));

$("clear-upload-pause-btn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_RESUME_UPLOAD_ATTEMPT", tabId: tab.id }).catch(() => null);
  if (response?.ok) {
    $("clear-upload-pause-btn").style.display = "none";
    showStatus("The safe pre-upload pause was cleared. No file had been selected.", "success", "autofill-status");
  } else {
    showStatus(response?.failure?.message || response?.error || "This upload pause cannot be cleared safely.", "error", "autofill-status");
  }
});

// ── Download Resume ───────────────────────────────────────────────────────

$("download-resume-btn").addEventListener("click", () => triggerResumeDownload());

async function triggerResumeDownload(jobId = null) {
  const port = getPort();
  if (!jobId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const hashMatch = tab.url.match(/rt_job_id=(\d+)/);
      if (hashMatch) jobId = parseInt(hashMatch[1], 10);
    }
    if (!jobId) {
      const stored = await chrome.storage.local.get("activeJobId");
      jobId = stored.activeJobId || null;
    }
  }
  $("download-resume-btn").disabled = true;
  showStatus("Requesting resume download…", "info", "autofill-status");

  chrome.runtime.sendMessage(
    { type: "DOWNLOAD_RESUME", port, jobId },
    (resp) => {
      $("download-resume-btn").disabled = false;
      if (chrome.runtime.lastError || !resp?.ok) {
        showStatus(resp?.error || chrome.runtime.lastError?.message || "Download failed", "error", "autofill-status");
      } else {
        showStatus(`Downloaded: ${resp.filename} — check your Downloads folder`, "success", "autofill-status");
      }
    }
  );
}

// ── Resume upload modal ───────────────────────────────────────────────────

function showResumeModal() {
  $("resume-modal").style.display = "block";

  $("modal-download-btn").onclick = () => {
    $("resume-modal").style.display = "none";
    triggerResumeDownload(null);
  };

  $("modal-manual-btn").onclick = () => {
    $("resume-modal").style.display = "none";
    showStatus("Skipped — you can upload the resume manually.", "info", "autofill-status");
  };
}

// ── Open profile in app ───────────────────────────────────────────────────

$("open-profile-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: `http://localhost:${getPort()}/profile` });
});

$("open-answers-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: `http://localhost:${getPort()}/answers` });
});

$("mark-applied-btn").addEventListener("click", async () => {
  const jobId = $("mark-applied-btn").dataset.jobId;
  if (!jobId) return;
  const port = getPort();
  $("mark-applied-btn").disabled = true;
  showStatus("Marking as applied…", "info", "autofill-status");

  try {
    const res = await fetch(`http://localhost:${port}/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "applied" }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    showStatus("Marked as applied in Resume Tracker!", "success", "autofill-status");
  } catch (err) {
    showStatus(err.message, "error", "autofill-status");
  } finally {
    $("mark-applied-btn").disabled = false;
  }
});

// ── Import tab init ───────────────────────────────────────────────────────

async function init() {
  const { savedPort } = await chrome.storage.local.get("savedPort");
  if (savedPort) $("port").value = savedPort;
  $("port").addEventListener("change", async () => {
    await chrome.storage.local.set({ savedPort: $("port").value });
    await checkPortConnection();
  });
  await checkPortConnection();

  setupAiToggle();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isLinkedIn =
    tab?.url?.includes("linkedin.com/jobs") ||
    tab?.url?.includes("linkedin.com/feed") ||
    tab?.url?.includes("linkedin.com/search/results");

  // Auto-switch to autofill tab for job application pages
  const isJobAppPage = tab?.url && /apply|application|greenhouse\.io|lever\.co|workday\.com|ashbyhq\.com|icims\.com|taleo\.net/i.test(tab.url) && !tab.url.includes("linkedin.com");
  if (isJobAppPage) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    $("tab-autofill").classList.add("active");
    $("panel-autofill").classList.add("active");
    initAutoFillTab();
    return;
  }

  if (!isLinkedIn) {
    $("main").style.display = "none";
    $("not-linkedin").style.display = "block";
    return;
  }

  // ── Stage 1: DOM scraping ────────────────────────────────────────────────
  showStatus("Reading job details from page…", "info");
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    await injectLearnedSelectors(tab.id, tab.url);

    const [{ result: job }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        if (window.__resumeTrackerExtractAsync) {
          return await window.__resumeTrackerExtractAsync(10, 400);
        }
        return window.__resumeTrackerExtract?.() ?? null;
      },
    });

    if (job) {
      $("company").value     = job.company     || "";
      $("title").value       = job.title       || "";
      $("description").value = job.description || "";
      $("job_link").value    = job.url         || "";
    }
  } catch (err) {
    console.warn("DOM scrape failed:", err.message);
  }

  // ── Stage 2: keep AI as an explicit manual fallback ─────────────────────
  const missing1 = missingFields();
  if (missing1.length === 0) {
    hideStatus();
    return;
  }

  showStatus(
    `Automatic detection is missing: ${missing1.join(", ")}. Reopen the extension after the job panel finishes loading, or use the manual AI fallback below.`,
    "warning"
  );
  openAiFallback();
}

// AI Parse button
$("parse-btn").addEventListener("click", async () => {
  const pasteText = $("paste-area").value.trim();
  if (!pasteText) {
    showStatus("Please paste some job posting text first.", "error");
    return;
  }

  const port = getPort();
  const parseBtn = $("parse-btn");
  parseBtn.disabled = true;
  parseBtn.innerHTML = '<span class="spinner"></span>Parsing with AI…';
  showStatus("AI is extracting job details…", "info");

  try {
    const res = await fetch(`http://localhost:${port}/api/parse-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pasteText }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    if (data.title) $("title").value = data.title;
    if (data.company) $("company").value = data.company;
    if (data.description) $("description").value = data.description;

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      learnAndSaveSelectors(activeTab.id, {
        title:       $("title").value.trim(),
        company:     $("company").value.trim(),
        description: $("description").value.trim(),
      });
    }

    const extras = [];
    if (data.location) extras.push(`Location: ${data.location}`);
    if (data.requirements?.length) extras.push(`${data.requirements.length} requirements extracted`);

    hideStatus();
    showStatus("AI extraction complete!" + (extras.length ? " " + extras.join(" · ") : ""), "success");

    $("ai-body").classList.remove("open");
    $("ai-chevron").classList.remove("open");
  } catch (err) {
    showStatus(
      err.message.includes("Failed to fetch")
        ? `Cannot reach app on port ${port}. Is it running?`
        : "AI parse failed: " + err.message,
      "error"
    );
  } finally {
    parseBtn.disabled = false;
    parseBtn.textContent = "Parse with AI";
  }
});

$("send-btn").addEventListener("click", async () => {
  const company = $("company").value.trim();
  const title = $("title").value.trim();
  const description = $("description").value.trim();
  const job_link = $("job_link").value.trim();
  const port = getPort();

  if (!company || !title || !description) {
    showStatus("Company, title, and description are required.", "error");
    return;
  }

  $("send-btn").disabled = true;
  showStatus("Sending to Resume Tracker…", "info");

  try {
    const res = await fetch(`http://localhost:${port}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, title, description, job_link }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    showStatus(`✓ Added! "${title}" at ${company}`, "success");

    setTimeout(() => {
      chrome.tabs.create({ url: `http://localhost:${port}/` });
    }, 1200);
  } catch (err) {
    showStatus(
      err.message.includes("Failed to fetch")
        ? `Cannot reach app on port ${port}. Is it running?`
        : err.message,
      "error"
    );
    $("send-btn").disabled = false;
  }
});

$("open-btn").addEventListener("click", () => {
  chrome.tabs.create({ url: `http://localhost:${getPort()}/` });
});

// Listen for resume upload detection from content-autofill.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "RESUME_UPLOAD_STAGE") {
    if (activePopupTabId && msg.status?.tabId !== activePopupTabId) return;
    showResumeUploadStatus(msg.status);
    return;
  }
  if (msg.type === "RESUME_UPLOAD_DETECTED") {
    // Switch to autofill tab and show modal if popup is open
    const autofillTab = $("tab-autofill");
    if (autofillTab) {
      autofillTab.click();
      setTimeout(() => showResumeModal(), 200);
    }
  }
});

init();
