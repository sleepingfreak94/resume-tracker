const $ = (id) => document.getElementById(id);

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

function getPort() {
  const v = parseInt($("port").value, 10);
  return isNaN(v) || v < 1 ? 3000 : v;
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

// ── Import tab helpers ────────────────────────────────────────────────────

function applyJobFields(data, { onlyMissing = false } = {}) {
  if (data.title   && (!onlyMissing || !$("title").value.trim()))
    $("title").value = data.title;
  if (data.company && (!onlyMissing || !$("company").value.trim()))
    $("company").value = data.company;
  if (data.description && (!onlyMissing || !$("description").value.trim()))
    $("description").value = data.description;
}

function missingFields() {
  const out = [];
  if (!$("company").value.trim())     out.push("company");
  if (!$("title").value.trim())       out.push("title");
  if (!$("description").value.trim()) out.push("description");
  return out;
}

// ── Stage 2: silently send page text to AI ───────────────────────────────

async function autoAiFill(tabId, port) {
  showStatus("Auto-detection incomplete — asking AI to read the page…", "info");

  const [{ result: pageText }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__resumeTrackerGetPageText?.() ?? document.body.innerText.slice(0, 12000),
  });

  if (!pageText || pageText.trim().length < 50) {
    throw new Error("Could not read page content.");
  }

  const res = await fetch(`http://localhost:${port}/api/parse-job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: pageText }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  return await res.json();
}

// ── Selector persistence helpers ──────────────────────────────────────────

function selectorStorageKey(pageType) {
  // Version the cache whenever extraction rules change so a selector learned
  // from an older LinkedIn layout cannot keep returning a wrong designation.
  return `learnedSelectors_v2_${pageType}`;
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
    const learned = stored[key];
    if (!learned) return;

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

  // Show page context
  const statusEl = $("autofill-page-status");
  const isAppPage = tab?.url?.includes(`localhost:${port}`);
  const isJobAppPage = tab?.url && /apply|application|careers|greenhouse\.io|lever\.co|workday\.com|ashbyhq\.com|icims\.com|taleo\.net/i.test(tab.url);

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

// ── Auto Apply ────────────────────────────────────────────────────────────

async function runAutoApply(fieldsOnly = false) {
  const port = getPort();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const btn = fieldsOnly ? $("fill-fields-btn") : $("fill-btn");
  btn.disabled = true;
  showStatus(fieldsOnly ? "Filling form fields…" : "Auto applying…", "info", "autofill-status");

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-autofill.js"],
    });

    let jobId = null;
    if (tab.url) {
      const hashMatch = tab.url.match(/rt_job_id=(\d+)/);
      if (hashMatch) jobId = parseInt(hashMatch[1], 10);
    }
    if (!jobId) {
      const stored = await chrome.storage.local.get("activeJobId");
      jobId = stored.activeJobId || null;
    }

    if (fieldsOnly) {
      const profileRes = await fetch(`http://localhost:${port}/api/profile`);
      if (!profileRes.ok) throw new Error(`App not responding on port ${port}`);
      const profile = await profileRes.json();

      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (profileData) => window.__rtAutoFill?.fillPage(profileData) ?? null,
        args: [profile],
      });

      if (!result || result.filled === 0) {
        showStatus("No matching fields found on this page.", "warning", "autofill-status");
      } else {
        showStatus(`Filled ${result.filled} field${result.filled === 1 ? "" : "s"}.`, "success", "autofill-status");
      }
      return;
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (p, j) => window.__rtAutoFill?.autoApply(p, j) ?? null,
      args: [port, jobId],
    });

    if (!result) {
      showStatus("Could not access the page. Try refreshing it.", "error", "autofill-status");
      return;
    }

    const parts = [];
    if (result.filled > 0) parts.push(`${result.filled} field${result.filled === 1 ? "" : "s"}`);
    if (result.resumeUploaded > 0) parts.push("resume uploaded");
    if (result.coverLetterFilled > 0) parts.push("cover letter");

    if (parts.length === 0) {
      showStatus("No matching fields found. Review the form manually.", "warning", "autofill-status");
    } else {
      showStatus(`Auto applied: ${parts.join(", ")}. Review and submit.`, "success", "autofill-status");
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
  showStatus("Requesting DOCX download…", "info", "autofill-status");

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
  $("port").addEventListener("change", () =>
    chrome.storage.local.set({ savedPort: $("port").value })
  );

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

  // ── Stage 2: if anything is missing, silently ask AI ────────────────────
  const missing1 = missingFields();
  if (missing1.length === 0) {
    hideStatus();
    return;
  }

  try {
    const aiData = await autoAiFill(tab.id, getPort());
    applyJobFields(aiData, { onlyMissing: true });

    if (aiData.title || aiData.company || aiData.description) {
      learnAndSaveSelectors(tab.id, {
        title:       $("title").value.trim(),
        company:     $("company").value.trim(),
        description: $("description").value.trim(),
      });
    }

    const missing2 = missingFields();
    if (missing2.length === 0) {
      hideStatus();
      showStatus("Job details extracted via AI. Selectors updated for next time.", "success");
      return;
    }

    showStatus(
      `AI filled in what it could. Still missing: ${missing2.join(", ")}. Paste the job text below.`,
      "warning"
    );
    openAiFallback();
  } catch (aiErr) {
    const isFetchErr = aiErr.message.includes("Failed to fetch");
    showStatus(
      isFetchErr
        ? `App not running on port ${getPort()}. Paste job text below for AI extraction once the app is started.`
        : `Auto-read failed (${aiErr.message}). Paste the job text below.`,
      "warning"
    );
    openAiFallback();
  }
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
