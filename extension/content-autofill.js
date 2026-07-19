// content-autofill.js — injected into job application pages
// Detects form fields and fills them with profile data from the local app.

(function () {
  // Guard against double-injection
  if (window.__resumeTrackerAutoFillLoaded) return;
  window.__resumeTrackerAutoFillLoaded = true;

  // ── Field mapping ──────────────────────────────────────────────────────────
  // Maps profile keys → arrays of regex patterns to match against:
  //   input name, id, placeholder, aria-label, and nearby label text.

  const FIELD_MAP = [
    { key: "first_name",    patterns: [/\bfirst[\s_-]?name\b/i, /\bgiven[\s_-]?name\b/i, /\bfname\b/i] },
    { key: "last_name",     patterns: [/\blast[\s_-]?name\b/i, /\bsurname\b/i, /\bfamily[\s_-]?name\b/i, /\blname\b/i] },
    { key: "email",         patterns: [/\bemail\b/i, /\be-mail\b/i] },
    { key: "phone",         patterns: [/\bphone\b/i, /\bmobile\b/i, /\bcell\b/i, /\btelephone\b/i, /\btel\b/i] },
    { key: "linkedin_url",  patterns: [/\blinkedin\b/i, /\blinked\s*in\b/i] },
    { key: "portfolio_url", patterns: [/\bportfolio\b/i, /\bwebsite\b/i, /\bpersonal\s*site\b/i, /\bpersonal\s*url\b/i] },
    { key: "location",      patterns: [/\bcity\b/i, /\blocation\b/i, /\baddress\b/i, /\bwhere.*live\b/i] },
    { key: "current_company", patterns: [/\bcurrent.*company\b/i, /\bemployer\b/i, /\bcompany\b/i, /\borganization\b/i] },
    { key: "current_title", patterns: [/\bjob\s*title\b/i, /\bcurrent\s*title\b/i, /\bposition\b/i, /\brole\b/i, /\btitle\b/i] },
    { key: "work_authorization", patterns: [/\bwork\s*auth/i, /\bauthorized\b/i, /\bvisa\b/i, /\bwork\s*status\b/i, /\beligib/i] },
    { key: "requires_sponsorship", patterns: [/\bsponsor/i, /\bvisa\s*sponsor/i, /\brequire.*sponsor/i] },
    { key: "has_work_permit", patterns: [/\bwork\s*permit\b/i, /\bvalid.*permit\b/i, /\bpermit.*work\b/i] },
    { key: "has_pr", patterns: [/\bpermanent\s*resid/i, /\bpr\s*status\b/i, /\bpermanent\s*resident\b/i, /\bgreen\s*card\b/i] },
    { key: "years_experience", patterns: [/\byears.*exp/i, /\bexperience.*years/i, /\byoe\b/i, /\byears\s*of\s*exp/i] },
    { key: "education_level", patterns: [/\beducation\b/i, /\bdegree\b/i, /\bhighest.*edu/i, /\bedu.*level/i] },
  ];

  // Patterns that identify resume/CV file upload fields
  const RESUME_UPLOAD_PATTERNS = [
    /\bresume\b/i, /\bcv\b/i, /\bcurriculum\s*vitae\b/i, /\bupload.*doc\b/i,
  ];

  const COVER_LETTER_PATTERNS = [
    /\bcover\s*letter\b/i, /\bcoverletter\b/i,
    /\bwhy.*(interested|join|work|company)\b/i,
    /\badditional\s*(info|information|comments|details)\b/i,
    /\btell\s*us\s*about\b/i,
  ];

  // ── Scoring: how well does a string match a list of patterns ──────────────

  function matchScore(str, patterns) {
    if (!str) return 0;
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(str)) return patterns.length - i; // earlier = higher priority
    }
    return 0;
  }

  // ── Label resolution ───────────────────────────────────────────────────────
  // Returns the text that labels an input element.

  function getLabelText(el) {
    // 1. <label for="..."> or wrapping <label>
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.innerText.trim();
    }
    const wrapping = el.closest("label");
    if (wrapping) return wrapping.innerText.trim();

    // 2. aria-label / aria-labelledby
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText.trim();
    }

    // 3. Nearest preceding sibling or parent text (for custom UIs)
    const parent = el.parentElement;
    if (parent) {
      // Check for a sibling label/div/span before the input
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(el);
      for (let i = idx - 1; i >= 0; i--) {
        const t = siblings[i].innerText?.trim();
        if (t && t.length < 80) return t;
      }
      // Parent's own direct text
      const directText = Array.from(parent.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (directText.length < 80) return directText;
    }

    return "";
  }

  // ── Score an input element against a field definition ─────────────────────

  function scoreInput(el, { patterns }) {
    let best = 0;
    const attrs = [
      el.name,
      el.id,
      el.placeholder,
      el.getAttribute("aria-label"),
      getLabelText(el),
    ];
    for (const attr of attrs) {
      const s = matchScore(attr, patterns);
      if (s > best) best = s;
    }
    return best;
  }

  // ── Find best matching input for each profile field ───────────────────────

  function findInputs() {
    // All fillable inputs (not hidden, submit, button, file, checkbox, radio)
    const textInputs = Array.from(
      document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select")
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0; // visible
    });

    const fileInputs = Array.from(
      document.querySelectorAll("input[type=file]")
    );

    return { textInputs, fileInputs };
  }

  // Detect if a file input is for a resume/CV
  function isResumeUpload(el) {
    const label = getLabelText(el);
    const accept = el.getAttribute("accept") || "";
    const combined = `${label} ${accept} ${el.name || ""} ${el.id || ""}`;
    return RESUME_UPLOAD_PATTERNS.some((p) => p.test(combined));
  }

  // ── Fill a single input ───────────────────────────────────────────────────

  function fillInput(el, value) {
    if (!value && value !== 0) return false;

    const strValue = String(value);

    if (el.tagName === "SELECT") {
      // Match by option text or value
      const opts = Array.from(el.options);
      const lower = strValue.toLowerCase();

      // Exact value match
      let match = opts.find((o) => o.value.toLowerCase() === lower);
      // Exact text match
      if (!match) match = opts.find((o) => o.text.toLowerCase() === lower);
      // Partial text match
      if (!match) match = opts.find((o) => o.text.toLowerCase().includes(lower) || lower.includes(o.text.toLowerCase()));
      // Special: sponsorship (yes/no)
      if (!match && /^(yes|1|true)$/i.test(strValue)) {
        match = opts.find((o) => /yes|required|need/i.test(o.text));
      }
      if (!match && /^(no|0|false)$/i.test(strValue)) {
        match = opts.find((o) => /no|not|don't/i.test(o.text));
      }

      if (match) {
        el.value = match.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }

    // For checkboxes (yes/no sponsorship fields)
    if (el.type === "checkbox") {
      const checked = /^(yes|1|true)$/i.test(strValue);
      if (el.checked !== checked) {
        el.checked = checked;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return el.checked === checked;
    }

    if (el.value === strValue) return false; // already correct

    // React/Vue-aware fill: set nativeInputValueSetter to trigger change events
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;
    const nativeTextareaSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;

    const setter = el.tagName === "TEXTAREA" ? nativeTextareaSetter : nativeInputValueSetter;
    if (setter) {
      setter.call(el, strValue);
    } else {
      el.value = strValue;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // ── Highlight filled fields ───────────────────────────────────────────────

  function highlightFilled(el) {
    const prev = el.style.cssText;
    el.style.outline = "2px solid #22c55e";
    el.style.transition = "outline 0.3s";
    setTimeout(() => {
      el.style.cssText = prev;
    }, 2000);
  }

  // ── Job ID from app → extension handoff ───────────────────────────────────

  function resolveJobId() {
    const hashMatch = location.hash.match(/rt_job_id=(\d+)/);
    if (hashMatch) return parseInt(hashMatch[1], 10);

    const q = new URLSearchParams(location.search).get("rt_job_id");
    if (q) return parseInt(q, 10);

    const stored = sessionStorage.getItem("rt_job_id");
    if (stored) return parseInt(stored, 10);

    return null;
  }

  function persistJobId(jobId) {
    if (!jobId) return;
    sessionStorage.setItem("rt_job_id", String(jobId));
    chrome.storage.local.set({ activeJobId: jobId }).catch(() => {});
  }

  function detectTrackedJobId() {
    return resolveJobId();
  }

  // ── Cover letter + file upload helpers ────────────────────────────────────

  function stripMarkdown(text) {
    return text
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();
  }

  function fillCoverLetter(text) {
    const plain = stripMarkdown(text);
    const { textInputs } = findInputs();
    let filled = 0;

    for (const el of textInputs) {
      if (el.tagName !== "TEXTAREA" && el.type !== "text") continue;
      const attrs = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), getLabelText(el)];
      const matches = attrs.some((a) => COVER_LETTER_PATTERNS.some((p) => p.test(a || "")));
      if (matches && fillInput(el, plain)) {
        highlightFilled(el);
        filled++;
      }
    }
    return filled;
  }

  function uploadFileToInput(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  async function fetchResumeContent(port, jobId) {
    let content = null;
    let filename = "resume.docx";

    if (jobId) {
      const res = await fetch(`http://localhost:${port}/api/resume/tailored/${jobId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.exists && data.content) {
          content = data.content;
          filename = `resume-job-${jobId}.docx`;
        }
      }
    }

    if (!content) {
      const res = await fetch(`http://localhost:${port}/api/resume`);
      if (!res.ok) throw new Error("No resume found");
      const data = await res.json();
      content = data.content;
      filename = jobId ? `resume-job-${jobId}.docx` : "resume.docx";
    }

    return { content, filename };
  }

  async function autoApply(port, jobId) {
    jobId = jobId || resolveJobId();
    if (jobId) persistJobId(jobId);

    const profileRes = await fetch(`http://localhost:${port}/api/profile`);
    if (!profileRes.ok) throw new Error(`App not responding (HTTP ${profileRes.status})`);
    const profile = await profileRes.json();

    const result = fillPage(profile);

    let resumeUploaded = 0;
    try {
      const { content, filename } = await fetchResumeContent(port, jobId);
      const docxRes = await fetch(`http://localhost:${port}/api/resume/docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, filename }),
      });
      if (docxRes.ok) {
        const blob = await docxRes.blob();
        const file = new File([blob], filename, {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        const { fileInputs } = findInputs();
        for (const input of fileInputs.filter(isResumeUpload)) {
          if (uploadFileToInput(input, file)) {
            highlightFilled(input);
            resumeUploaded++;
          }
        }
      }
    } catch {
      // Resume upload is best-effort; profile fields may still be filled
    }

    let coverLetterFilled = 0;
    if (jobId) {
      try {
        const clRes = await fetch(`http://localhost:${port}/api/resume/cover-letter/${jobId}`);
        if (clRes.ok) {
          const clData = await clRes.json();
          if (clData.exists && clData.content) {
            coverLetterFilled = fillCoverLetter(clData.content);
          }
        }
      } catch {
        // Cover letter is optional
      }
    }

    return {
      filled: result.filled,
      resumeUploaded,
      coverLetterFilled,
      resumeUploads: result.resumeUploads,
      jobId,
    };
  }

  // ── Main fill function ────────────────────────────────────────────────────

  function fillPage(profile) {
    const { textInputs, fileInputs } = findInputs();
    let filled = 0;
    const prevValues = {};

    for (const fieldDef of FIELD_MAP) {
      const value = profile[fieldDef.key];
      if (!value && value !== 0) continue;

      // Score all text inputs against this field, pick the best
      let bestScore = 0;
      let bestEl = null;
      for (const el of textInputs) {
        const s = scoreInput(el, fieldDef);
        if (s > bestScore) { bestScore = s; bestEl = el; }
      }

      if (bestEl && bestScore > 0) {
        prevValues[fieldDef.key] = bestEl.value;
        if (fillInput(bestEl, value)) {
          highlightFilled(bestEl);
          filled++;
        }
      }
    }

    // Detect resume upload fields
    const resumeUploads = fileInputs.filter(isResumeUpload);

    return { filled, prevValues, resumeUploads: resumeUploads.length };
  }

  // ── Detect if current page looks like a job application form ──────────────

  function isJobApplicationPage() {
    const url = window.location.href;
    // URL hints
    if (/apply|application|careers|jobs\/apply|job-application|submit.*resume/i.test(url)) return true;

    // Form must exist
    const forms = document.querySelectorAll("form");
    if (forms.length === 0) return false;

    // Look for typical application field labels in the page
    const pageText = document.body.innerText.slice(0, 5000);
    const appKeywords = /\b(first name|last name|email|resume|cover letter|work authorization|apply|submit application)\b/i;
    return appKeywords.test(pageText);
  }

  // ── Inject floating action button ─────────────────────────────────────────

  function injectFAB() {
    if (document.getElementById("rt-fab")) return; // already injected

    const fab = document.createElement("div");
    fab.id = "rt-fab";
    fab.innerHTML = `
      <div id="rt-fab-btn" title="Resume Tracker: Fill this form">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      </div>
      <div id="rt-fab-menu" style="display:none">
        <button id="rt-fill-btn">Auto Apply</button>
        <button id="rt-resume-btn">Download Resume</button>
        <button id="rt-close-fab">✕</button>
      </div>
      <div id="rt-toast"></div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #rt-fab {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #rt-fab-btn {
        width: 48px;
        height: 48px;
        background: #4f46e5;
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(79,70,229,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, transform 0.15s;
      }
      #rt-fab-btn:hover { background: #4338ca; transform: scale(1.05); }
      #rt-fab-btn svg { width: 24px; height: 24px; color: white; stroke: white; }
      #rt-fab-menu {
        position: absolute;
        bottom: 56px;
        right: 0;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 6px;
        min-width: 160px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      }
      #rt-fab-menu button {
        display: block;
        width: 100%;
        padding: 8px 12px;
        text-align: left;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: #f1f5f9;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.1s;
      }
      #rt-fab-menu button:hover { background: #334155; }
      #rt-close-fab { color: #64748b !important; font-size: 11px !important; }
      #rt-toast {
        position: absolute;
        bottom: 56px;
        right: 0;
        background: #0f172a;
        color: #f1f5f9;
        font-size: 12px;
        padding: 8px 12px;
        border-radius: 8px;
        border: 1px solid #334155;
        min-width: 200px;
        display: none;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        pointer-events: none;
      }
      #rt-toast.success { border-color: #166534; color: #86efac; background: #14532d; }
      #rt-toast.error   { border-color: #7f1d1d; color: #fca5a5; background: #450a0a; }
      #rt-toast.info    { border-color: #1e40af; color: #93c5fd; background: #1e3a5f; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(fab);

    const btn = document.getElementById("rt-fab-btn");
    const menu = document.getElementById("rt-fab-menu");
    const toast = document.getElementById("rt-toast");

    let toastTimer = null;

    function showToast(msg, type = "info", duration = 3000) {
      clearTimeout(toastTimer);
      menu.style.display = "none";
      toast.textContent = msg;
      toast.className = type;
      toast.style.display = "block";
      toastTimer = setTimeout(() => { toast.style.display = "none"; }, duration);
    }

    btn.addEventListener("click", () => {
      menu.style.display = menu.style.display === "none" ? "block" : "none";
      toast.style.display = "none";
    });

    document.getElementById("rt-close-fab").addEventListener("click", (e) => {
      e.stopPropagation();
      menu.style.display = "none";
    });

    document.addEventListener("click", (e) => {
      if (!fab.contains(e.target)) menu.style.display = "none";
    });

    document.getElementById("rt-fill-btn").addEventListener("click", async () => {
      menu.style.display = "none";
      showToast("Auto applying…", "info");

      const { savedPort } = await chrome.storage.local.get("savedPort");
      const port = parseInt(savedPort || "3000", 10);
      const jobId = resolveJobId();

      try {
        const result = await autoApply(port, jobId);
        const parts = [];
        if (result.filled > 0) parts.push(`${result.filled} field${result.filled === 1 ? "" : "s"}`);
        if (result.resumeUploaded > 0) parts.push("resume uploaded");
        if (result.coverLetterFilled > 0) parts.push("cover letter");

        if (parts.length === 0) {
          showToast("No matching fields found. Review the form manually.", "error");
        } else {
          showToast(`Auto applied: ${parts.join(", ")}. Review and submit.`, "success", 5000);
        }
      } catch (err) {
        const isFetch = err.message.includes("Failed to fetch");
        showToast(
          isFetch ? `App not running on port ${port}` : `Error: ${err.message}`,
          "error"
        );
      }
    });

    document.getElementById("rt-resume-btn").addEventListener("click", async () => {
      menu.style.display = "none";
      showToast("Downloading resume…", "info");

      const { savedPort } = await chrome.storage.local.get("savedPort");
      const port = parseInt(savedPort || "3000", 10);

      // Try to detect job ID from URL or page
      const jobId = detectTrackedJobId();

      chrome.runtime.sendMessage(
        { type: "DOWNLOAD_RESUME", port, jobId },
        (resp) => {
          if (chrome.runtime.lastError || !resp?.ok) {
            showToast(resp?.error || "Download failed", "error");
          } else {
            showToast(`Downloaded: ${resp.filename}`, "success", 4000);
          }
        }
      );
    });
  }

  // ── Expose API for popup to call via executeScript ────────────────────────

  window.__rtAutoFill = {
    fillPage,
    autoApply,
    isJobApplicationPage,
    detectTrackedJobId,
    resolveJobId,
  };

  // Persist job ID from app handoff on page load
  const initialJobId = resolveJobId();
  if (initialJobId) persistJobId(initialJobId);

  // ── Auto-inject FAB on job application pages ──────────────────────────────

  if (isJobApplicationPage()) {
    injectFAB();
  }

  // Watch for SPA navigation (Workday, Greenhouse use heavy JS routing)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isJobApplicationPage() && !document.getElementById("rt-fab")) {
        setTimeout(injectFAB, 800); // wait for SPA render
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
