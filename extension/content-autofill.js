// content-autofill.js — injected into job application pages
// Detects form fields and fills them with profile data from the local app.

(function () {
  // Guard only when the controller actually exists. A previous injection can
  // be interrupted after setting a flag (for example when the extension is
  // reloaded while a LinkedIn tab stays open), so a flag alone is not proof
  // that autofill is ready.
  if (window.__rtAutoFill?.autoApply && window.__rtAutoFill?.fillPage) return;
  window.__resumeTrackerAutoFillLoaded = false;

  // ── Scoped root ───────────────────────────────────────────────────────────
  // Set to an Element (e.g. an Easy Apply modal) to limit DOM queries.
  // Defaults to `document` when null.
  let _fillRoot = null;
  let _localPort = 3000;

  function root() { return _fillRoot || document; }

  // ── Field mapping ──────────────────────────────────────────────────────────
  // Maps profile keys → arrays of regex patterns to match against:
  //   input name, id, placeholder, aria-label, and nearby label text.

  const FIELD_MAP = [
    { key: "full_name",     patterns: [/\bfull[\s_-]?name\b/i, /\blegal[\s_-]?name\b/i, /\bapplicant[\s_-]?name\b/i, /\byour[\s_-]?name\b/i] },
    { key: "first_name",    patterns: [/\bfirst[\s_-]?name\b/i, /\bgiven[\s_-]?name\b/i, /\bfname\b/i] },
    { key: "last_name",     patterns: [/\blast[\s_-]?name\b/i, /\bsurname\b/i, /\bfamily[\s_-]?name\b/i, /\blname\b/i] },
    { key: "email",         patterns: [/\bemail\b/i, /\be-mail\b/i] },
    { key: "phone",         patterns: [/\bphone\b/i, /\bmobile\b/i, /\bcell\b/i, /\btelephone\b/i, /\btel\b/i] },
    { key: "linkedin_url",  patterns: [/\blinkedin\b/i, /\blinked\s*in\b/i] },
    { key: "portfolio_url", patterns: [/\bportfolio\b/i, /\bwebsite\b/i, /\bpersonal\s*site\b/i, /\bpersonal\s*url\b/i] },
    { key: "location",      patterns: [/\bcurrent[\s_-]?location\b/i, /\bcity\b/i, /\blocation\b/i, /\bwhere.*live\b/i] },
    { key: "current_company", patterns: [/\bcurrent.*company\b/i, /\bcurrent.*employer\b/i, /\bemployer[\s_-]?name\b/i, /\borganization[\s_-]?name\b/i] },
    { key: "current_title", patterns: [/\bcurrent.*job\s*title\b/i, /\bcurrent\s*title\b/i, /\bcurrent\s*position\b/i, /\bcurrent\s*role\b/i, /\boccupation\b/i] },
    { key: "work_authorization", patterns: [/\bwork\s*auth/i, /\bauthorized\b/i, /\bvisa\b/i, /\bwork\s*status\b/i, /\beligib/i] },
    { key: "requires_sponsorship", patterns: [/\bsponsor/i, /\bvisa\s*sponsor/i, /\brequire.*sponsor/i] },
    { key: "has_work_permit", patterns: [/\blegally.*authoriz.*work\b/i, /\bauthoriz.*work\b/i, /\bwork\s*permit\b/i, /\bvalid.*permit\b/i, /\bpermit.*work\b/i] },
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

  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0) return true;
    if (el.matches?.('input[type="radio"], input[type="checkbox"]')) {
      const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
      const labelRect = label?.getBoundingClientRect();
      return Boolean(labelRect && labelRect.width > 0 && labelRect.height > 0);
    }
    return false;
  }

  function getLabelText(el) {
    // 1. <label for="..."> or wrapping <label>
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return cleanText(label.innerText);
    }
    const wrapping = el.closest("label");
    if (wrapping) return cleanText(wrapping.innerText);

    // 2. aria-label / aria-labelledby
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return cleanText(ariaLabel);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || "")
        .filter(Boolean)
        .join(" ");
      if (text) return cleanText(text);
    }

    // 3. Group labels used by ATS radio/select components.
    const fieldset = el.closest("fieldset");
    const legend = fieldset?.querySelector(":scope > legend");
    if (legend) return cleanText(legend.innerText);

    const group = el.closest('[role="group"], [role="radiogroup"], [data-automation-id*="question"]');
    if (group) {
      const groupLabel = group.querySelector("legend, [data-automation-id*='label'], .label, label");
      if (groupLabel && !groupLabel.contains(el)) return cleanText(groupLabel.innerText);
    }

    // 4. Nearest preceding sibling or parent text (for custom UIs)
    const parent = el.parentElement;
    if (parent) {
      // Check for a sibling label/div/span before the input
      const siblings = Array.from(parent.children);
      const idx = siblings.indexOf(el);
      for (let i = idx - 1; i >= 0; i--) {
        const t = cleanText(siblings[i].innerText);
        if (t && t.length < 240) return t;
      }
      // Parent's own direct text
      const directText = Array.from(parent.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (directText.length < 240) return directText;
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
      el.getAttribute("autocomplete"),
      el.getAttribute("data-automation-id"),
    ];
    for (const attr of attrs) {
      const s = matchScore(attr, patterns);
      if (s > best) best = s;
    }
    return best;
  }

  // ── Find best matching input for each profile field ───────────────────────

  function findInputs() {
    const selector = [
      "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=password]):not([type=file])",
      "textarea",
      "select",
      '[role="combobox"]',
      '[contenteditable="true"]',
    ].join(",");
    const r = root();
    const textInputs = Array.from(new Set(r.querySelectorAll(selector)))
      .filter((el) => isVisible(el) && !el.readOnly && !el.closest("#rt-fab"));
    const fileInputs = Array.from(r.querySelectorAll("input[type=file]"))
      .filter((el) => !el.disabled && !el.closest("#rt-fab"));
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
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
        if (setter) setter.call(el, match.value);
        else el.value = match.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      }
      return false;
    }

    // For checkboxes (yes/no sponsorship fields)
    if (el.type === "checkbox" || el.type === "radio") {
      const checked = /^(yes|1|true)$/i.test(strValue);
      if (el.checked !== checked) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")?.set;
        if (setter) setter.call(el, checked);
        else el.checked = checked;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (checked) el.click();
        return true;
      }
      return el.checked === checked;
    }

    if (el.isContentEditable) {
      if (cleanText(el.innerText) === cleanText(strValue)) return false;
      el.focus();
      el.textContent = strValue;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: strValue }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
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
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function optionText(el) {
    return cleanText(getLabelText(el) || el.getAttribute("aria-label") || el.value || el.innerText);
  }

  function questionKind(el) {
    if (el.type === "radio") return "radio";
    if (el.type === "checkbox") return "checkbox";
    if (el.tagName === "SELECT") return "select";
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return "textarea";
    if (el.getAttribute("role") === "combobox") return "combobox";
    if (el.type === "number" || el.type === "range") return "number";
    if (el.type === "date" || el.type === "month") return "date";
    return "text";
  }

  let questionSequence = 0;

  function nextQuestionId(el) {
    if (!el.dataset.rtQuestionId) {
      questionSequence += 1;
      el.dataset.rtQuestionId = `rtq-${questionSequence}`;
    }
    return el.dataset.rtQuestionId;
  }

  function radioGroupLabel(radios) {
    const first = radios[0];
    const fieldset = first.closest("fieldset");
    const legend = fieldset?.querySelector(":scope > legend");
    if (legend) return cleanText(legend.innerText);
    const group = first.closest('[role="radiogroup"], [role="group"], [data-automation-id*="question"]');
    if (group) {
      const labelledBy = group.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
        if (cleanText(text)) return cleanText(text);
      }
      const candidate = group.querySelector("legend, [data-automation-id*='label'], .label, label");
      if (candidate && !radios.some((radio) => candidate.contains(radio))) return cleanText(candidate.innerText);
    }
    const individual = radios.map(optionText).filter(Boolean);
    const sharedParent = first.parentElement?.parentElement;
    const parentText = cleanText(sharedParent?.innerText);
    for (const option of individual) {
      if (parentText.startsWith(option)) continue;
      const stripped = cleanText(parentText.replace(option, ""));
      if (stripped && stripped.length < 500) return stripped;
    }
    return cleanText(getLabelText(first));
  }

  function comboboxOptions(el) {
    const controls = el.getAttribute("aria-controls");
    const owner = controls ? document.getElementById(controls) : null;
    const options = owner ? owner.querySelectorAll('[role="option"]') : [];
    return Array.from(options).map((option) => cleanText(option.innerText)).filter(Boolean).slice(0, 50);
  }

  function collectQuestionEntries(includeAnswered = false) {
    const { textInputs } = findInputs();
    const entries = [];
    const radioGroups = new Map();

    for (const el of textInputs) {
      if (el.type === "radio") {
        const groupKey = el.name || el.closest("fieldset")?.id || nextQuestionId(el.closest('[role="radiogroup"]') || el);
        if (!radioGroups.has(groupKey)) radioGroups.set(groupKey, []);
        radioGroups.get(groupKey).push(el);
        continue;
      }

      const kind = questionKind(el);
      const value = el.isContentEditable ? cleanText(el.innerText) : cleanText(el.value);
      const answered = kind === "checkbox" ? el.checked : kind === "select"
        ? Boolean(el.value) && !/^select|choose|please select$/i.test(cleanText(el.options?.[el.selectedIndex]?.text))
        : Boolean(value);
      if (!includeAnswered && answered) continue;

      const options = kind === "select"
        ? Array.from(el.options).map((option) => cleanText(option.text)).filter((text) => text && !/^select|choose|please select$/i.test(text)).slice(0, 50)
        : kind === "combobox" ? comboboxOptions(el) : [];
      entries.push({
        id: nextQuestionId(el),
        label: cleanText(getLabelText(el) || el.placeholder || el.name || el.id || "Application question"),
        kind,
        required: el.required || el.getAttribute("aria-required") === "true",
        options,
        elements: [el],
        searchText: cleanText(`${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${getLabelText(el)}`),
      });
    }

    for (const radios of radioGroups.values()) {
      if (!includeAnswered && radios.some((radio) => radio.checked)) continue;
      const label = radioGroupLabel(radios);
      entries.push({
        id: nextQuestionId(radios[0]),
        label: label || "Application question",
        kind: "radio",
        required: radios.some((radio) => radio.required || radio.getAttribute("aria-required") === "true"),
        options: radios.map(optionText).filter(Boolean).slice(0, 50),
        elements: radios,
        searchText: cleanText(`${radios[0].name || ""} ${radios[0].id || ""} ${label}`),
      });
    }

    return entries.filter((entry) => entry.label.length <= 500);
  }

  function normalizedChoice(value) {
    return cleanText(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function choiceMatches(option, value) {
    const optionValue = normalizedChoice(option);
    const wanted = normalizedChoice(value);
    if (!optionValue || !wanted) return false;
    if (optionValue === wanted) return true;
    if (/^(yes|true|1)$/.test(wanted)) return /^(yes|true|authorized|eligible)/.test(optionValue);
    if (/^(no|false|0)$/.test(wanted)) return /^(no|false|not authorized|ineligible)/.test(optionValue);
    return optionValue.includes(wanted) || wanted.includes(optionValue);
  }

  async function fillQuestion(entry, value) {
    if (value === null || value === undefined || value === "") return false;
    const el = entry.elements[0];

    if (entry.kind === "radio") {
      const target = entry.elements.find((radio) => choiceMatches(optionText(radio), value));
      if (!target) return false;
      if (target.checked) return false;
      target.click();
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (entry.kind === "checkbox") {
      const checked = value === true || /^(yes|1|true)$/i.test(String(value));
      if (el.checked === checked) return false;
      el.click();
      return el.checked === checked;
    }

    if (entry.kind === "combobox" && el.tagName !== "SELECT") {
      if (el.matches("input, textarea") || el.isContentEditable) fillInput(el, value);
      else el.click();
      el.focus?.();
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const controls = el.getAttribute("aria-controls");
      const owner = controls ? document.getElementById(controls) : document;
      const options = Array.from(owner?.querySelectorAll('[role="option"]') || []).filter(isVisible);
      const target = options.find((option) => choiceMatches(cleanText(option.innerText), value));
      if (target) target.click();
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    return fillInput(el, value);
  }

  function serializeQuestions(entries) {
    return entries.slice(0, 40).map(({ id, label, kind, required, options }) => ({
      id,
      label,
      kind,
      required,
      options,
    }));
  }

  function currentEntryValue(entry) {
    const el = entry.elements[0];
    if (!el) return null;
    if (entry.kind === "radio") {
      const checked = entry.elements.find((radio) => radio.checked);
      return checked ? optionText(checked) : null;
    }
    // An unchecked box is ambiguous: it may mean "No" or may simply be untouched.
    // Learn checked boxes only; explicit Yes/No radio groups are handled above.
    if (entry.kind === "checkbox") return el.checked ? true : null;
    if (entry.kind === "select") {
      if (!el.value) return null;
      const text = cleanText(el.options?.[el.selectedIndex]?.text);
      return text && !/^select|choose|please select$/i.test(text) ? text : null;
    }
    const raw = el.isContentEditable ? cleanText(el.innerText) : cleanText(el.value);
    if (!raw) return null;
    if (entry.kind === "number") {
      const number = Number(raw);
      return Number.isFinite(number) ? number : null;
    }
    return raw;
  }

  async function captureAnsweredQuestions(port, jobId, options = {}) {
    const previousRoot = _fillRoot;
    if (options.fillRoot) _fillRoot = options.fillRoot;
    try {
      const answers = collectQuestionEntries(true)
        .map((entry) => ({ ...serializeQuestions([entry])[0], value: currentEntryValue(entry) }))
        .filter((answer) => answer.value !== null && answer.value !== undefined && answer.value !== "")
        .slice(0, 40);
      if (answers.length === 0) return { saved: 0, updated: 0, corrected: 0, skipped: 0 };
      return await requestLocalApi(port, "/api/application-learning", {
        method: "POST",
        body: { jobId: jobId || null, answers },
      });
    } finally {
      _fillRoot = previousRoot;
    }
  }

  function requestLocalApi(port, path, { method = "GET", body, responseType = "json" } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "LOCAL_API", port, path, method, body, responseType },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || `Local API request failed (HTTP ${response?.status || 0})`));
            return;
          }
          resolve(response.data);
        }
      );
    });
  }

  function dataUrlToBlob(dataUrl) {
    const [metadata, encoded] = String(dataUrl).split(",", 2);
    if (!metadata || encoded === undefined) throw new Error("Invalid document response");
    const mime = metadata.match(/^data:([^;]+)/)?.[1] || "application/octet-stream";
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function runtimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => resolve(response || null));
    });
  }

  function setAutoFillSession(port, jobId) {
    return runtimeMessage({ type: "SET_AUTOFILL_SESSION", port, jobId });
  }

  function clearAutoFillSession() {
    return runtimeMessage({ type: "CLEAR_AUTOFILL_SESSION" });
  }

  function controlIsAnswered(el) {
    if (el.type === "radio") {
      if (!el.name) return el.checked;
      return Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)).some((radio) => radio.checked);
    }
    if (el.type === "checkbox") return el.checked;
    if (el.type === "file") return Boolean(el.files?.length);
    if (el.tagName === "SELECT") return Boolean(el.value);
    if (el.isContentEditable) return Boolean(cleanText(el.innerText));
    return Boolean(cleanText(el.value));
  }

  function requiredFieldsMissing() {
    const r = root();
    const controls = Array.from(r.querySelectorAll("input, textarea, select, [contenteditable='true'], [role='combobox']"))
      .filter((el) => !el.closest("#rt-fab, #rt-auto-progress") && !el.disabled && (el.required || el.getAttribute("aria-required") === "true"));
    const missing = [];
    const radioNames = new Set();
    for (const el of controls) {
      if (el.type === "radio" && el.name) {
        if (radioNames.has(el.name)) continue;
        radioNames.add(el.name);
      }
      if (!controlIsAnswered(el)) missing.push(cleanText(getLabelText(el) || el.name || el.id || "Required field"));
    }
    const invalid = Array.from(r.querySelectorAll('[aria-invalid="true"]')).filter(isVisible);
    for (const el of invalid) {
      const label = cleanText(getLabelText(el) || el.name || el.id || "Invalid field");
      if (!missing.includes(label)) missing.push(label);
    }
    return missing;
  }

  function personalReviewReasons(entries = []) {
    const reasons = [];
    const manualPattern = /\b(i\s+certify|certify\s+that|certification\s+(?:of|that)|electronic\s+signature|type\s+your\s+signature|consent|terms\s+and\s+conditions|privacy\s+policy|acknowledge|background\s+check|criminal|conviction|social\s+security|social\s+insurance|ssn|passport|driver'?s?\s+licen[cs]e|national\s+id|government\s+id|bank\s+account|credit\s+card|password)\b/i;
    for (const entry of entries) {
      if (manualPattern.test(entry.label)) reasons.push(entry.label);
    }
    if (document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], [class*='captcha' i], [id*='captcha' i]")) {
      reasons.push("CAPTCHA");
    }
    return [...new Set(reasons)];
  }

  function actionButtonText(el) {
    return cleanText(el.innerText || el.value || el.getAttribute("aria-label") || el.title);
  }

  function findApplicationAction() {
    const candidates = Array.from(root().querySelectorAll("button, input[type='submit'], input[type='button'], [role='button']"))
      .filter((el) => isVisible(el) && !el.closest("#rt-fab, #rt-auto-progress") && !el.disabled && el.getAttribute("aria-disabled") !== "true");
    // LinkedIn Easy Apply adds these aria-labels on its modal buttons.
    const finalPattern = /^(submit( application)?|send application|finish application|complete application|apply now)$/i;
    const nextPattern = /^(next|continue to next step|continue|save( and)? continue|save & continue|review( your)? application|proceed)(\s*[›>→])?$/i;
    const finalButton = candidates.find((el) => finalPattern.test(actionButtonText(el)));
    const nextButton = candidates.find((el) => nextPattern.test(actionButtonText(el)));
    if (nextButton) return { element: nextButton, final: false, label: actionButtonText(nextButton) };
    if (finalButton) return { element: finalButton, final: true, label: actionButtonText(finalButton) };
    return null;
  }

  function applicationStepSignature() {
    const controls = Array.from(document.querySelectorAll("input, textarea, select, [role='combobox']"))
      .filter((el) => !el.closest("#rt-fab, #rt-auto-progress") && isVisible(el))
      .map((el) => `${el.tagName}:${el.type || ""}:${el.name || ""}:${getLabelText(el)}`)
      .join("|");
    return `${location.pathname}${location.search}::${controls}`;
  }

  async function waitForSamePageStepChange(previousSignature, previousUrl) {
    const started = Date.now();
    while (Date.now() - started < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (location.href !== previousUrl) return false;
      if (applicationStepSignature() !== previousSignature) return true;
    }
    return false;
  }

  function automationPanel() {
    let panel = document.getElementById("rt-auto-progress");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "rt-auto-progress";
    panel.style.cssText = "position:fixed;right:24px;bottom:24px;z-index:2147483647;width:min(340px,calc(100vw - 32px));padding:14px 16px;border-radius:14px;border:1px solid rgba(199,243,107,.35);background:#0d1016;color:#f5f5f4;box-shadow:0 18px 50px rgba(0,0,0,.45);font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    panel.innerHTML = '<div id="rt-auto-copy"></div><button id="rt-auto-cancel" type="button" style="margin-top:10px;width:100%;border:1px solid rgba(255,255,255,.12);border-radius:9px;background:rgba(255,255,255,.05);color:#d1d5db;padding:8px 10px;font-weight:600;cursor:pointer">Pause automation</button>';
    document.body.appendChild(panel);
    return panel;
  }

  function showAutomationMessage(message, { cancellable = false, duration = 6000 } = {}) {
    const panel = automationPanel();
    panel.querySelector("#rt-auto-copy").textContent = message;
    const cancel = panel.querySelector("#rt-auto-cancel");
    cancel.style.display = cancellable ? "block" : "none";
    if (!cancellable && duration > 0) setTimeout(() => panel.remove(), duration);
    return { panel, cancel };
  }

  async function automationCountdown(seconds, actionLabel, final) {
    const { panel, cancel } = showAutomationMessage("", { cancellable: true });
    let cancelled = false;
    cancel.onclick = () => {
      cancelled = true;
      panel.querySelector("#rt-auto-copy").textContent = "Automation paused by you.";
      cancel.style.display = "none";
      clearAutoFillSession();
      setTimeout(() => panel.remove(), 3000);
    };
    for (let remaining = seconds; remaining > 0; remaining--) {
      panel.querySelector("#rt-auto-copy").textContent = `${final ? "Submitting" : `Clicking ${actionLabel}`} in ${remaining} second${remaining === 1 ? "" : "s"}.`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (cancelled) return false;
    }
    if (!cancelled) panel.querySelector("#rt-auto-copy").textContent = final ? "Submitting application…" : `Opening ${actionLabel}…`;
    return !cancelled;
  }

  async function runAutomationStep({ port, jobId, questionsUnanswered, personalReview, settings }) {
    if (!settings) {
      try {
        settings = await requestLocalApi(port, "/api/application-settings");
      } catch {
        return { state: "settings-unavailable" };
      }
    }
    if (!settings.auto_continue) {
      await clearAutoFillSession();
      return { state: "disabled" };
    }

    const missing = requiredFieldsMissing();
    if (missing.length > 0) {
      await clearAutoFillSession();
      showAutomationMessage(`Paused: ${missing.length} required field${missing.length === 1 ? " is" : "s are"} incomplete.`, { duration: 8000 });
      return { state: "paused-required", missing };
    }
    if (personalReview.length > 0) {
      await clearAutoFillSession();
      showAutomationMessage("Paused: a certification, consent, signature, background check, or CAPTCHA needs your personal confirmation.", { duration: 0 });
      return { state: "paused-safety", reasons: personalReview };
    }
    if (settings.pause_on_unknown && questionsUnanswered > 0) {
      await clearAutoFillSession();
      showAutomationMessage(`Paused: ${questionsUnanswered} question${questionsUnanswered === 1 ? " needs" : "s need"} your review.`, { duration: 8000 });
      return { state: "paused-unknown" };
    }

    const action = findApplicationAction();
    if (!action) {
      await clearAutoFillSession();
      return { state: "no-action" };
    }
    if (action.final && settings.final_review) {
      await clearAutoFillSession();
      showAutomationMessage("Final review is on. Review the application, then submit when ready.", { duration: 0 });
      return { state: "final-review", label: action.label };
    }

    const proceed = await automationCountdown(settings.wait_seconds, action.label, action.final);
    if (!proceed) return { state: "cancelled" };

    const previousSignature = applicationStepSignature();
    const previousUrl = location.href;
    if (!action.final) await setAutoFillSession(port, jobId);
    else await clearAutoFillSession();
    action.element.click();

    if (action.final) {
      showAutomationMessage("Application submitted automatically. Verify the confirmation page.", { duration: 8000 });
      return { state: "submitted", label: action.label };
    }

    const changedHere = await waitForSamePageStepChange(previousSignature, previousUrl);
    if (changedHere) return { state: "next", label: action.label, continueHere: true };
    return { state: "next", label: action.label, continueHere: false };
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
      if (matches && !controlIsAnswered(el) && fillInput(el, plain)) {
        highlightFilled(el);
        filled++;
      }
    }
    return filled;
  }

  function coverLetterInputs() {
    const { textInputs } = findInputs();
    return textInputs.filter((el) => {
      if (el.tagName !== "TEXTAREA" && el.type !== "text" && !el.isContentEditable) return false;
      const attrs = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), getLabelText(el)];
      return attrs.some((value) => COVER_LETTER_PATTERNS.some((pattern) => pattern.test(value || "")));
    });
  }

  function isRequiredControl(el) {
    if (el.required || el.getAttribute("aria-required") === "true") return true;
    const label = getLabelText(el);
    const container = el.closest("fieldset, [role='group'], [data-automation-id*='question'], .form-group");
    return /\brequired\b|\*/i.test(`${label} ${container?.innerText || ""}`.slice(0, 500));
  }

  function isExplicitCoverLetterControl(el) {
    const text = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), getLabelText(el)].join(" ");
    return /\bcover\s*letter\b/i.test(text);
  }

  function uploadFileToInput(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.files?.length === 1 && input.files[0]?.name === file.name && input.files[0]?.size === file.size;
    } catch {
      return false;
    }
  }

  async function fetchResumeContent(port, jobId, format = "docx", strict = false) {
    let content = null;
    let filename = `resume.${format}`;

    if (jobId) {
      try {
        const data = await requestLocalApi(port, `/api/resume/tailored/${jobId}`);
        if (data.exists && data.content) {
          content = data.content;
          filename = `resume-job-${jobId}.${format}`;
        }
      } catch {
        if (strict) throw new Error("The required tailored resume could not be loaded");
      }
    }

    if (!content) {
      if (strict) throw new Error("A current job-specific tailored resume is required for automated runs");
      const data = await requestLocalApi(port, "/api/resume");
      if (!data.content) throw new Error("No resume found");
      content = data.content;
      filename = jobId ? `resume-job-${jobId}.${format}` : `resume.${format}`;
    }

    return { content, filename };
  }

  async function autoApply(port, jobId, options = {}) {
    _localPort = Number(port) || 3000;
    jobId = jobId || resolveJobId();
    if (jobId) persistJobId(jobId);

    // Set scoped root for all DOM queries in this call
    _fillRoot = options.fillRoot || null;

    const profile = await requestLocalApi(port, "/api/profile");

    // options.settings overrides the stored settings (e.g. per-run auto_submit flag)
    let settings = options.settings || null;
    if (!settings) {
      try {
        settings = await requestLocalApi(port, "/api/application-settings");
      } catch {
        // Profile filling still works; DOCX remains the resume default.
      }
    }
    const resumeFormat = settings?.resume_format === "pdf" ? "pdf" : "docx";

    const result = await fillPage(profile);
    const strictAutoRun = settings?.strict_auto_run === true || settings?.require_tailored_resume === true;

    let resumeUploaded = 0;
    let resumeUploadError = null;
    const resumeInputs = findInputs().fileInputs.filter(isResumeUpload);
    if (resumeInputs.length > 0) {
      try {
        const { content, filename } = await fetchResumeContent(port, jobId, resumeFormat, strictAutoRun);
        const documentDataUrl = await requestLocalApi(port, `/api/resume/${resumeFormat}`, {
          method: "POST",
          body: { content, filename },
          responseType: "dataUrl",
        });
        if (!documentDataUrl) throw new Error(`${resumeFormat.toUpperCase()} conversion returned no file`);
        const blob = dataUrlToBlob(documentDataUrl);
        if (!blob.size) throw new Error(`${resumeFormat.toUpperCase()} conversion returned an empty file`);
        const file = new File([blob], filename, {
          type: resumeFormat === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        for (const input of resumeInputs) {
          if (uploadFileToInput(input, file)) {
            highlightFilled(input);
            resumeUploaded++;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        const assignmentsVerified = resumeInputs.every((input) => input.files?.length === 1 && input.files[0]?.name === file.name && input.files[0]?.size === file.size);
        if (resumeUploaded !== resumeInputs.length || !assignmentsVerified) throw new Error("The resume file could not be assigned to every visible upload control");
      } catch (error) {
        resumeUploadError = error instanceof Error ? error.message : String(error);
      }
    }

    let coverLetterFilled = 0;
    let coverLetterError = null;
    const coverInputs = coverLetterInputs();
    const requiredCoverInputs = coverInputs.filter(isExplicitCoverLetterControl).filter(isRequiredControl).filter((input) => !controlIsAnswered(input));
    if (jobId && coverInputs.length > 0) {
      try {
        let clData = await requestLocalApi(port, `/api/resume/cover-letter/${jobId}`);
        if (requiredCoverInputs.length > 0 && (!clData.exists || !clData.content)) {
          await requestLocalApi(port, `/api/cover-letter/${jobId}`, { method: "POST" });
          clData = await requestLocalApi(port, `/api/resume/cover-letter/${jobId}`);
        }
        if (clData.exists && clData.content) {
          coverLetterFilled = fillCoverLetter(clData.content);
        }
        if (requiredCoverInputs.some((input) => !controlIsAnswered(input))) {
          throw new Error("The required cover letter could not be filled");
        }
      } catch (error) {
        if (requiredCoverInputs.length > 0) coverLetterError = error instanceof Error ? error.message : String(error);
      }
    }

    if (strictAutoRun && resumeInputs.length > 0 && (resumeUploadError || resumeUploaded !== resumeInputs.length)) {
      return {
        filled: result.filled, resumeUploaded, coverLetterFilled, resumeUploads: result.resumeUploads,
        resumeFormat, jobId, resumeUploadError,
        automation: { state: "paused-resume-upload", reason: resumeUploadError || "Resume upload could not be verified" },
      };
    }
    if (requiredCoverInputs.length > 0 && coverLetterError) {
      return {
        filled: result.filled, resumeUploaded, coverLetterFilled, resumeUploads: result.resumeUploads,
        resumeFormat, jobId, coverLetterError,
        automation: { state: "paused-cover-letter", reason: coverLetterError },
      };
    }

    let aiQuestionsFilled = 0;
    let questionsUnanswered = 0;
    let aiError = null;
    const unansweredEntries = collectQuestionEntries(false);
    const personalReview = personalReviewReasons(unansweredEntries);
    if (unansweredEntries.length > 0) {
      try {
        const answerData = await requestLocalApi(port, "/api/application-answers", {
          method: "POST",
          body: {
            jobId: jobId || null,
            pageUrl: window.location.href.slice(0, 2_000),
            questions: serializeQuestions(unansweredEntries),
          },
        });

        const entryMap = new Map(unansweredEntries.map((entry) => [entry.id, entry]));
        for (const answer of answerData.answers || []) {
          if (answer.value === null || answer.value === undefined) continue;
          const entry = entryMap.get(answer.id);
          if (!entry) continue;
          if (await fillQuestion(entry, answer.value)) {
            entry.elements.forEach(highlightFilled);
            aiQuestionsFilled++;
          }
        }
        questionsUnanswered = Number(answerData.unanswered || 0) + Math.max(0, unansweredEntries.length - (answerData.answers?.length || 0));
      } catch (err) {
        aiError = err instanceof Error ? err.message : String(err);
        questionsUnanswered = unansweredEntries.length;
      }
    }

    const automation = await runAutomationStep({ port, jobId, questionsUnanswered, personalReview, settings });
    const response = {
      filled: result.filled,
      resumeUploaded,
      coverLetterFilled,
      aiQuestionsFilled,
      questionsDetected: unansweredEntries.length,
      questionsUnanswered,
      personalReviewNeeded: personalReview.length,
      aiError,
      resumeUploadError,
      coverLetterError,
      resumeUploads: result.resumeUploads,
      resumeFormat,
      jobId,
      automation,
    };
    if (automation.continueHere) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return autoApply(port, jobId, { ...options, continuation: true });
    }
    return response;
  }

  // ── Main fill function ────────────────────────────────────────────────────

  async function fillPage(profile) {
    const { fileInputs } = findInputs();
    let filled = 0;
    const prevValues = {};
    const entries = collectQuestionEntries(false);
    const used = new Set();
    const profileValues = {
      ...profile,
      full_name: cleanText(`${profile.first_name || ""} ${profile.last_name || ""}`),
    };

    for (const fieldDef of FIELD_MAP) {
      const value = profileValues[fieldDef.key];
      if (!value && value !== 0) continue;

      // Score all unanswered controls against this field, without reusing one
      // control for multiple profile keys.
      let bestScore = 0;
      let bestEntry = null;
      for (const entry of entries) {
        if (used.has(entry.id)) continue;
        const pseudoElement = entry.elements[0];
        const s = Math.max(scoreInput(pseudoElement, fieldDef), matchScore(entry.searchText, fieldDef.patterns));
        if (s > bestScore) { bestScore = s; bestEntry = entry; }
      }

      if (bestEntry && bestScore > 0) {
        const bestEl = bestEntry.elements[0];
        prevValues[fieldDef.key] = bestEl.value || bestEl.innerText || "";
        if (await fillQuestion(bestEntry, value)) {
          bestEntry.elements.forEach(highlightFilled);
          filled++;
          used.add(bestEntry.id);
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
        <button id="rt-fill-btn">Start Auto-Fill</button>
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
        if (result.resumeUploaded > 0) parts.push(`${String(result.resumeFormat || "docx").toUpperCase()} resume uploaded`);
        if (result.coverLetterFilled > 0) parts.push("cover letter");
        if (result.aiQuestionsFilled > 0) parts.push(`${result.aiQuestionsFilled} AI answer${result.aiQuestionsFilled === 1 ? "" : "s"}`);

        if (parts.length === 0) {
          showToast(result.aiError || "No matching fields found. Review the form manually.", "error", 5000);
        } else {
          const review = result.questionsUnanswered > 0 ? ` ${result.questionsUnanswered} need review.` : "";
          const automationText = result.automation?.state === "submitted"
            ? " Application submitted; verify the confirmation page."
            : result.automation?.state === "final-review"
              ? " Final review is waiting for you."
              : result.automation?.state === "next"
                ? " Continued to the next step."
                : " Review the page before continuing.";
          showToast(`Filled: ${parts.join(", ")}.${review}${automationText}`, result.aiError ? "error" : "success", 7000);
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
    version: "3.1",
    fillPage,
    autoApply,
    captureAnsweredQuestions,
    isJobApplicationPage,
    detectTrackedJobId,
    resolveJobId,
    setFillRoot: (el) => { _fillRoot = el || null; },
  };

  // Persist job ID from app handoff on page load
  const initialJobId = resolveJobId();
  if (initialJobId) persistJobId(initialJobId);
  chrome.storage.local.get("savedPort").then(({ savedPort }) => {
    const saved = Number(savedPort);
    if (Number.isInteger(saved) && saved > 0 && saved <= 65535) _localPort = saved;
  }).catch(() => {});

  // A trusted click means the candidate, rather than this script, chose to move
  // forward. Snapshot completed fields before the form changes or closes.
  document.addEventListener("click", (event) => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const action = event.target.closest("button, input[type='submit'], input[type='button'], [role='button']");
    if (!action || action.closest("#rt-fab, #rt-auto-progress, #rt-run-progress")) return;
    if (!/^(next|continue(?: to next step)?|save(?: and| &) continue|review(?: your)? application|proceed|submit(?: application)?|send application|finish application|complete application|apply now)$/i.test(actionButtonText(action))) return;
    const captureRoot = action.closest("[role='dialog'], form") || _fillRoot;
    void captureAnsweredQuestions(_localPort, detectTrackedJobId(), { fillRoot: captureRoot })
      .catch((error) => console.warn("[ResumeTracker] Could not learn answers before navigation:", error));
  }, true);

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

  // Mark the script loaded only after the public controller and its observer
  // have been installed successfully.
  window.__resumeTrackerAutoFillLoaded = true;

})();
