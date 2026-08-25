// Background service worker — handles DOCX downloads and cross-script messaging

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;

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
        const { savedPort } = await chrome.storage.local.get("savedPort");
        const port = parseInt(savedPort || "3000", 10);
        const res = await fetch(`http://localhost:${port}/api/linkedin-run/active`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.run) return;
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
      if (Date.now() - Number(session.startedAt || 0) > 5 * 60 * 1000) {
        await chrome.storage.session.remove(key);
        return;
      }
      if (!tab.url || /chrome:\/\/|chrome-extension:\/\//.test(tab.url)) {
        await chrome.storage.session.remove(key);
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

  // Fetch the resume markdown content
  let resumeContent = null;
  let resolvedFilename = filename || `resume.${format}`;

  if (jobId) {
    // Try to get tailored resume for this job
    const tailoredRes = await fetch(`http://localhost:${port}/api/resume/tailored/${jobId}`);
    if (tailoredRes.ok) {
      const data = await tailoredRes.json();
      if (data.content) {
        resumeContent = data.content;
        resolvedFilename = `resume-job-${jobId}.${format}`;
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
