// Background service worker — handles document downloads, CDP uploads, and cross-script messaging

importScripts("resume-cdp.js");

const resumeCdpController = ResumeTrackerCdp.createResumeCdpController({
  chromeApi: chrome,
  fetchImpl: fetch,
  toDataUrl: blobToDataUrl,
  onStage: (status) => chrome.runtime.sendMessage({
    type: "RESUME_UPLOAD_STAGE",
    status,
  }).catch(() => {}),
  validateAcceptance: ({ tabId, frameId, targetToken, filename, method }) => chrome.tabs.sendMessage(tabId, {
    type: "VALIDATE_RESUME_UPLOAD_ACCEPTANCE",
    targetToken,
    filename,
    method,
  }, { frameId }),
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "UPLOAD_RESUME_VIA_CDP") {
    resumeCdpController.upload(msg, sender).then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        filename: null,
        method: "chooser",
        cdpStatus: "failed",
        stage: "background_worker",
        failure: {
          reason: "cdp_rejected",
          message: error instanceof Error ? error.message : String(error),
          stage: "background_worker",
        },
      });
    });
    return true;
  }

  if (msg.type === "GET_RESUME_UPLOAD_STATUS") {
    const tabId = Number(msg.tabId || sender.tab?.id);
    resumeCdpController.getLatestStatus({ tabId })
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (msg.type === "CLEAR_RESUME_UPLOAD_ATTEMPT") {
    const tabId = Number(msg.tabId || sender.tab?.id);
    resumeCdpController.clearLatestStatus({ tabId })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (msg.type === "DASHBOARD_AUTOFILL_HANDOFF") {
    const tabId = sender.tab?.id;
    const port = Number(msg.port);
    const jobId = Number(msg.jobId);
    if (!tabId || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(jobId) || jobId <= 0) {
      sendResponse({ ok: false, error: "Invalid dashboard autofill handoff" });
      return;
    }
    const session = { mode: "dashboard-resume-watch", port, jobId, startedAt: Date.now() };
    chrome.storage.session.set({ [`autoFillSession_${tabId}`]: session })
      .then(async () => {
        await armDashboardResumeUpload(tabId, session);
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "CLEAR_DASHBOARD_AUTOFILL_WATCH") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    const key = `autoFillSession_${tabId}`;
    chrome.storage.session.get(key).then((stored) => {
      if (stored[key]?.mode === "dashboard-resume-watch") return chrome.storage.session.remove(key);
      return undefined;
    }).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "SET_AUTOFILL_SESSION") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    chrome.storage.session.set({
      [`autoFillSession_${tabId}`]: {
        port: msg.port || 3000,
        jobId: msg.jobId || null,
        pageUrl: sender.tab.url || "",
        startedAt: Date.now(),
      },
    }).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "CLEAR_AUTOFILL_SESSION") {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    chrome.storage.session.remove(`autoFillSession_${tabId}`).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "LOCAL_API") {
    handleLocalApiRequest(msg).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, status: 0, error: err.message });
    });
    return true;
  }

  if (msg.type === "DOWNLOAD_RESUME") {
    handleResumeDownload(msg, sender).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true; // keep channel open for async response
  }

  if (msg.type === "GET_PROFILE") {
    const port = msg.port || 3000;
    fetch(`http://localhost:${port}/api/profile`)
      .then((r) => r.json())
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "FILL_STATUS") {
    // Relay fill-status from content script → popup (if open)
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

const ALLOWED_LOCAL_API = [
  { method: "GET", pattern: /^\/api\/profile$/ },
  { method: "GET", pattern: /^\/api\/resume$/ },
  { method: "GET", pattern: /^\/api\/resume\/tailored\/\d+$/ },
  { method: "GET", pattern: /^\/api\/resume\/cover-letter\/\d+$/ },
  { method: "GET", pattern: /^\/api\/application-settings$/ },
  { method: "POST", pattern: /^\/api\/resume\/docx$/ },
  { method: "POST", pattern: /^\/api\/resume\/pdf$/ },
  { method: "POST", pattern: /^\/api\/application-answers$/ },
  { method: "POST", pattern: /^\/api\/application-learning$/ },
  { method: "POST", pattern: /^\/api\/parse-job$/ },
  { method: "POST", pattern: /^\/api\/cover-letter\/\d+$/ },
  { method: "GET",   pattern: /^\/api\/jobs\/\d+$/ },
  { method: "PATCH", pattern: /^\/api\/jobs\/\d+$/ },
  // LinkedIn auto-apply run endpoints
  { method: "GET",   pattern: /^\/api\/linkedin-run\/active$/ },
  { method: "GET",   pattern: /^\/api\/linkedin-run\/\d+$/ },
  { method: "PATCH", pattern: /^\/api\/linkedin-run\/\d+$/ },
  { method: "POST",  pattern: /^\/api\/linkedin-run\/\d+\/job$/ },
  { method: "POST",  pattern: /^\/api\/linkedin-run\/\d+\/tailor$/ },
];

const autoFillContinuationLocks = new Set();
const linkedInRunLocks = new Set();

async function armDashboardResumeUpload(tabId, session) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content-autofill.js"] });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (port, jobId) => window.__rtAutoFill?.armResumeUpload(port, jobId),
    args: [session.port, session.jobId],
  });
}

function linkedInAppPortFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const port = Number(new URLSearchParams(url.hash.replace(/^#/, "")).get("resume-tracker-port"));
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

function linkedInRunIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
    const runId = Number(new URLSearchParams(url.hash.replace(/^#/, "")).get("resume-tracker-run"));
    return Number.isInteger(runId) && runId > 0 ? runId : null;
  } catch {
    return null;
  }
}

function linkedInRunHandoffFromUrl(value) {
  const port = linkedInAppPortFromUrl(value);
  const runId = linkedInRunIdFromUrl(value);
  return port && runId ? { port, runId } : null;
}

async function resolveLinkedInRunHandoff(tabId, url) {
  const handoff = linkedInRunHandoffFromUrl(url);
  const key = `linkedInRunHandoff_${tabId}`;
  if (handoff) {
    await chrome.storage.local.set({ savedPort: String(handoff.port) });
    await chrome.storage.session.set({ [key]: handoff });
    return handoff;
  }
  const stored = await chrome.storage.session.get(key);
  const saved = stored[key];
  if (!saved) return null;
  const port = Number(saved.port);
  const runId = Number(saved.runId);
  return Number.isInteger(port) && port >= 1 && port <= 65535 && Number.isInteger(runId) && runId > 0
    ? { port, runId }
    : null;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;

  // Capture the port handoff as soon as the search URL appears. LinkedIn may
  // later rewrite unknown fragments before the page reaches "complete".
  if (changeInfo.url && /linkedin\.com\/jobs\/search/i.test(tab.url || changeInfo.url)) {
    const handoff = linkedInRunHandoffFromUrl(tab.url || changeInfo.url);
    if (handoff) {
      chrome.storage.local.set({ savedPort: String(handoff.port) }).catch(() => {});
      chrome.storage.session.set({ [`linkedInRunHandoff_${tabId}`]: handoff }).catch(() => {});
    }
  }

  // ── LinkedIn auto-apply run injection ────────────────────────────────────
  // When a jobs/search page finishes loading and there's an active run, inject
  // the three run scripts. Guard with a per-tab lock to prevent double injection.
  if (
    tab.url &&
    /linkedin\.com\/jobs\/search/i.test(tab.url) &&
    changeInfo.status === "complete" &&
    !linkedInRunLocks.has(tabId)
  ) {
    linkedInRunLocks.add(tabId);
    setTimeout(async () => {
      try {
        const handoff = await resolveLinkedInRunHandoff(tabId, tab.url);
        if (!handoff) return;
        const res = await fetch(`http://localhost:${handoff.port}/api/linkedin-run/active`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.run) return;
        if (Number(data.run.id) !== handoff.runId) {
          console.warn("[ResumeTracker] Ignoring a LinkedIn search tab for a different run");
          return;
        }
        if (data.recovery?.state === "interrupted" && data.recovery?.canResume !== true) {
          console.warn("[ResumeTracker] Refusing to resume an interrupted in-flight LinkedIn application");
          return;
        }
        // Inject in order: content.js (extractor) → content-autofill.js (filler) → crawler
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content-autofill.js"] });
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content-linkedin-run.js"] });
      } catch (err) {
        console.warn("[ResumeTracker] Could not start LinkedIn run:", err.message);
      } finally {
        linkedInRunLocks.delete(tabId);
      }
    }, 1_500);
    return; // Don't also try autofill continuation on a LinkedIn search page
  }

  // ── Autofill session continuation ────────────────────────────────────────
  if (autoFillContinuationLocks.has(tabId)) return;
  autoFillContinuationLocks.add(tabId);
  setTimeout(async () => {
    try {
      const key = `autoFillSession_${tabId}`;
      const stored = await chrome.storage.session.get(key);
      const session = stored[key];
      if (!session) return;
      const sessionLifetime = session.mode === "dashboard-resume-watch" ? 10 * 60 * 1000 : 5 * 60 * 1000;
      if (Date.now() - Number(session.startedAt || 0) > sessionLifetime) {
        await chrome.storage.session.remove(key);
        return;
      }
      if (!tab.url || /chrome:\/\/|chrome-extension:\/\//.test(tab.url)) {
        await chrome.storage.session.remove(key);
        return;
      }
      if (session.mode === "dashboard-resume-watch") {
        if (!/linkedin\.com\/jobs\//i.test(tab.url)) {
          await chrome.storage.session.remove(key);
          return;
        }
        await armDashboardResumeUpload(tabId, session);
        return;
      }
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content-autofill.js"] });
      await chrome.scripting.executeScript({
        target: { tabId },
        func: async (port, jobId) => await window.__rtAutoFill?.autoApply(port, jobId, { continuation: true }),
        args: [session.port || 3000, session.jobId || null],
      });
    } catch (err) {
      console.warn("[ResumeTracker] Could not continue autofill:", err.message);
    } finally {
      autoFillContinuationLocks.delete(tabId);
    }
  }, changeInfo.status === "complete" ? 900 : 1300);
});

async function handleLocalApiRequest({ port, path, method = "GET", body, responseType = "json" }) {
  const parsedPort = Number(port || 3000);
  const normalizedMethod = String(method).toUpperCase();
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error("Invalid local app port");
  }
  if (typeof path !== "string" || !ALLOWED_LOCAL_API.some((rule) => rule.method === normalizedMethod && rule.pattern.test(path))) {
    throw new Error("Local API path is not allowed");
  }

  const response = await fetch(`http://localhost:${parsedPort}${path}`, {
    method: normalizedMethod,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (responseType === "dataUrl") {
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return { ok: false, status: response.status, error: errorBody.error || `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status, data: await blobToDataUrl(await response.blob()) };
  }

  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? null : data.error || `HTTP ${response.status}`,
  };
}

async function handleResumeDownload({ port, jobId, filename }) {
  port = port || 3000;

  let format = /\.pdf$/i.test(filename || "") ? "pdf" : "docx";
  if (!filename) {
    try {
      const settingsRes = await fetch(`http://localhost:${port}/api/application-settings`);
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        format = settings.resume_format === "pdf" ? "pdf" : "docx";
      }
    } catch {
      // DOCX remains the default if settings are unavailable.
    }
  }

  let profile = null;
  try {
    const profileRes = await fetch(`http://localhost:${port}/api/profile`);
    if (profileRes.ok) profile = await profileRes.json();
  } catch {
    // The document can still be downloaded with the safe fallback name.
  }

  // Fetch the resume markdown content
  let resumeContent = null;
  const resolvedFilename = ResumeTrackerCdp.profileResumeFilename(profile, format);

  if (jobId) {
    // Try to get tailored resume for this job
    const tailoredRes = await fetch(`http://localhost:${port}/api/resume/tailored/${jobId}`);
    if (tailoredRes.ok) {
      const data = await tailoredRes.json();
      if (data.content) {
        resumeContent = data.content;
      }
    }
  }

  // Fall back to base resume
  if (!resumeContent) {
    const baseRes = await fetch(`http://localhost:${port}/api/resume`);
    if (baseRes.ok) {
      const data = await baseRes.json();
      resumeContent = data.content;
    }
  }

  if (!resumeContent) {
    throw new Error("No resume found. Please add your base resume in the app first.");
  }

  // Convert Markdown to the configured application format via the app API.
  const documentRes = await fetch(`http://localhost:${port}/api/resume/${format}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: resumeContent, filename: resolvedFilename }),
  });

  if (!documentRes.ok) {
    const err = await documentRes.json().catch(() => ({}));
    throw new Error(err.error || `${format.toUpperCase()} generation failed: HTTP ${documentRes.status}`);
  }

  const blob = await documentRes.blob();
  const dataUrl = await blobToDataUrl(blob);

  await chrome.downloads.download({
    url: dataUrl,
    filename: resolvedFilename,
    saveAs: false,
  });

  return { ok: true, filename: resolvedFilename };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
