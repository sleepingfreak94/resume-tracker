// Runs in the LinkedIn page context to extract job details from the DOM.
// Handles both full job pages (/jobs/view/...) and the search/feed preview panels.
// Uses polling to wait for dynamically loaded content.

function extractLinkedInJob() {

  // ── Try learned selectors first (saved from a previous AI fix) ───────────
  const learned = window.__resumeTrackerLearnedSelectors;
  if (learned) {
    const fromLearned = extractWithLearnedSelectors(learned);
    const hasAll = fromLearned?.title && fromLearned?.company && fromLearned?.description;
    if (hasAll) {
      // Still need URL — run that part of the generic extractor
      const url = (() => {
        let u = window.location.href;
        const p = new URLSearchParams(window.location.search);
        let id = p.get("currentJobId");
        if (!id) { const m = u.match(/\/jobs\/view\/(\d+)/); if (m) id = m[1]; }
        if (!id) { const el = document.querySelector('[data-job-id]'); if (el) id = el.getAttribute('data-job-id'); }
        if (id) return `https://www.linkedin.com/jobs/view/${id}`;
        return u.includes("/jobs/view/") ? u.split("?")[0] : u;
      })();
      return { ...fromLearned, url };
    }
    // Partial hit — merge what we got and let the generic path fill the rest
    window.__resumeTrackerPartialFromLearned = fromLearned || {};
  } else {
    window.__resumeTrackerPartialFromLearned = null;
  }

  // ─────────────────────────────── helpers ────────────────────────────────

  function getText(selectors, root) {
    const scope = root || document;
    for (const sel of selectors) {
      try {
        const el = scope.querySelector(sel);
        if (el?.innerText?.trim()) return el.innerText.trim();
      } catch { /* invalid selector */ }
    }
    return "";
  }

  function getAttr(selectors, attr, root) {
    const scope = root || document;
    for (const sel of selectors) {
      try {
        const el = scope.querySelector(sel);
        const val = el?.getAttribute(attr)?.trim();
        if (val) return val;
      } catch { /* skip */ }
    }
    return "";
  }

  // ──────────────────────── page-type detection ────────────────────────────

  const href = window.location.href;
  const isJobDetailPage = /linkedin\.com\/jobs\/view\//.test(href);
  // ─────────────────────── active job card (search) ────────────────────────
  // On search pages the right panel shows the selected job. We try to scope
  // the extraction to that panel to avoid reading stale list-card data.

  const rightPanel =
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.jobs-search-two-pane__detail-view') ||
    document.querySelector('[class*="jobs-search-two-pane__detail"]') ||
    document.querySelector('[class*="job-details"]') ||
    document.querySelector('.scaffold-layout__detail');

  // The selected/active card in the list pane — useful for title fallback
  const activeCard =
    document.querySelector('[class*="job-card-container--active"]') ||
    document.querySelector('[class*="job-card"][aria-selected="true"]') ||
    document.querySelector('[class*="jobs-search-results__list-item--active"]') ||
    document.querySelector('li[class*="active"] .job-card-container') ||
    // fallback: first result if nothing is explicitly active
    document.querySelector('[class*="job-card-list__entity-lockup"]');

  // ───────────────────────────── TITLE ─────────────────────────────────────

  let title = "";

  // 1. Right panel h1 / h2 (job detail page & search panel)
  if (rightPanel) {
    title = getText(['h1', 'h2', '[class*="job-title"]', '[class*="jobs-unified-top-card"] h1', '[class*="topcard"] h1'], rightPanel);
  }

  // 2. Any h1 in the page (detail page)
  if (!title && isJobDetailPage) {
    title =
      getText(['main h1', '.scaffold-layout h1', '[role="main"] h1']) ||
      getText(['h1[class*="title"]', 'a[class*="job-title"]']);
  }

  // 3. Active card title (search page)
  if (!title && activeCard) {
    title = getText(
      [
        'a[class*="job-card-container__link"]',
        '[class*="job-card-list__title"]',
        '[class*="job-card-container__link"]',
        'a[data-tracking-control-name*="job_card_title"]',
        'a[class*="job-card"]',
        'strong',
      ],
      activeCard
    );
  }

  // 4. Broader search: any element whose aria-label mentions "job title"
  if (!title) {
    title = getText(['[aria-label*="job title" i]']);
  }

  // 5. Data attributes
  if (!title) {
    title = getAttr(['[data-job-title]'], 'data-job-title');
  }

  // 6. OG meta fallback
  if (!title) {
    const og = document.querySelector('meta[property="og:title"]')?.content || "";
    const m = og.match(/^(.+?)\s+(?:at|@)\s+/i) || og.match(/^(.+?)\s*[-–|]/);
    if (m) title = m[1].trim();
  }

  // ──────────────────────────── COMPANY ────────────────────────────────────

  let company = "";

  // 1. Company link in right panel
  if (rightPanel) {
    const links = rightPanel.querySelectorAll('a[href*="/company/"]');
    for (const link of links) {
      const t = link.innerText?.trim();
      if (t && t.length > 1 && t.length < 100) { company = t; break; }
    }
    if (!company) {
      company = getText(
        [
          '[class*="topcard__org-name-link"]',
          '[class*="company-name"]',
          '[class*="jobs-unified-top-card__company"]',
          '[class*="job-details-jobs-unified-top-card__company"]',
          '[data-tracking-control-name*="company"]',
          'span[class*="company"]',
        ],
        rightPanel
      );
    }
  }

  // 2. Active card company
  if (!company && activeCard) {
    company = getText(
      [
        '[class*="job-card-container__primary-description"]',
        '[class*="job-card-container__company"]',
        '[class*="job-card__company-name"]',
        'a[href*="/company/"]',
        'span[class*="company"]',
      ],
      activeCard
    );
  }

  // 3. Any /company/ link on page (skip sidebars/recommendations)
  if (!company) {
    const links = document.querySelectorAll('a[href*="/company/"]');
    for (const link of links) {
      const nearest = link.closest('section, article, li');
      const label = nearest?.getAttribute('aria-label') || "";
      if (/similar|recommend|also viewed/i.test(label)) continue;
      const t = link.innerText?.trim();
      if (t && t.length > 1 && t.length < 100) { company = t; break; }
    }
  }

  // 4. OG meta fallback
  if (!company) {
    const og = document.querySelector('meta[property="og:title"]')?.content || "";
    const m = og.match(/\bat\s+(.+?)\s*[-–|]/i) || og.match(/\bat\s+(.+?)$/i);
    if (m) company = m[1].trim();
  }

  // ─────────────────────────── DESCRIPTION ─────────────────────────────────

  let description = "";

  // 1. Stable ARIA-labelled section — works on both page types
  const ariaDescSelectors = [
    'section[aria-label*="About the job" i]',
    'section[aria-label*="Job description" i]',
    'section[aria-label*="description" i]',
    '[aria-label*="job description" i]',
    'article[aria-label*="job" i]',
  ];
  for (const sel of ariaDescSelectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()?.length > 100) { description = el.innerText.trim(); break; }
  }

  // 2. #job-details (LinkedIn frequently uses this id)
  if (!description) {
    const jd = document.querySelector('#job-details');
    if (jd?.innerText?.trim()?.length > 100) description = jd.innerText.trim();
  }

  // 3. Right-panel rich-text content blocks
  if (!description && rightPanel) {
    const candidates = [
      '[class*="jobs-description__content"]',
      '[class*="jobs-description-content"]',
      '[class*="description__text"]',
      '[class*="jobs-box__html-content"]',
      '.show-more-less-html__markup',
      '[class*="jobs-description"]',
      '[class*="job-description"]',
      '[class*="html-content"]',
      '[class*="rich-text"]',
    ];
    for (const sel of candidates) {
      try {
        const el = rightPanel.querySelector(sel);
        if (el?.innerText?.trim()?.length > 100) { description = el.innerText.trim(); break; }
      } catch { /* skip */ }
    }
  }

  // 4. Same candidates without panel scoping
  if (!description) {
    const candidates = [
      '[class*="jobs-description__content"]',
      '[class*="jobs-description-content"]',
      '[class*="description__text"]',
      '[class*="jobs-box__html-content"]',
      '.show-more-less-html__markup',
      '[class*="jobs-description"]',
      '[class*="job-description"]',
      '[class*="html-content"]',
      '[class*="rich-text"]',
    ];
    for (const sel of candidates) {
      try {
        const el = document.querySelector(sel);
        if (el?.innerText?.trim()?.length > 100) { description = el.innerText.trim(); break; }
      } catch { /* skip */ }
    }
  }

  // 5. Longest div inside right panel (last resort)
  if (!description && rightPanel) {
    let longest = "";
    for (const div of rightPanel.querySelectorAll('div')) {
      const t = div.innerText?.trim();
      if (t && t.length > longest.length && t.length > 200) longest = t;
    }
    if (longest) description = longest;
  }

  // Strip LinkedIn page-chrome noise lines from the captured description
  if (description) {
    description = description
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        if (/^\d+\s+(people|applicants)\s+(clicked|applied)/i.test(t)) return false;
        if (/^(reposted?|easy apply)\b/i.test(t)) return false;
        if (/\d+\s+(days?|weeks?|months?)\s+ago/i.test(t)) return false;
        return true;
      })
      .join("\n")
      .trim();
  }

  // ───────────────────────────── URL / JOB ID ──────────────────────────────

  let url = window.location.href;
  const params = new URLSearchParams(window.location.search);

  let jobId = params.get("currentJobId");

  if (!jobId) {
    const m = url.match(/\/jobs\/view\/(\d+)/);
    if (m) jobId = m[1];
  }

  if (!jobId) {
    // Check data-job-id on any element (often on <li> in search results)
    const el =
      document.querySelector('[class*="active"] [data-job-id]') ||
      document.querySelector('[aria-selected="true"] [data-job-id]') ||
      document.querySelector('[data-job-id]');
    if (el) jobId = el.getAttribute('data-job-id');
  }

  if (!jobId) {
    // Grab job ID from highlighted card's link
    const link =
      document.querySelector('[class*="active"] a[href*="/jobs/view/"]') ||
      document.querySelector('[aria-selected="true"] a[href*="/jobs/view/"]') ||
      document.querySelector('a[href*="/jobs/view/"]');
    const m = link?.href?.match(/\/jobs\/view\/(\d+)/);
    if (m) jobId = m[1];
  }

  if (jobId) {
    url = `https://www.linkedin.com/jobs/view/${jobId}`;
  } else if (url.includes("/jobs/view/")) {
    url = url.split("?")[0];
  }

  // Merge any partial hits from learned selectors (fills gaps without overwriting)
  const partial = window.__resumeTrackerPartialFromLearned || {};
  return {
    title:       title       || partial.title       || "",
    company:     company     || partial.company     || "",
    description: description || partial.description || "",
    url,
  };
}

// ───────────── Async wrapper: retries until content is loaded ─────────────

async function extractLinkedInJobWithRetry(maxAttempts = 10, delayMs = 400) {
  for (let i = 0; i < maxAttempts; i++) {
    const result = extractLinkedInJob();
    const hasTitle       = result.title?.length > 2;
    const hasCompany     = result.company?.length > 1;
    const hasDescription = result.description?.length > 100;

    if (hasTitle && hasCompany && hasDescription) return result;

    if (i === maxAttempts - 1) return result;

    await new Promise(r => setTimeout(r, delayMs));
  }
  return extractLinkedInJob();
}

// ─── Selector learning (called after AI successfully fills data) ──────────
//
// Given the AI-confirmed values for title/company/description, walks the DOM
// to find which elements actually contain those strings and builds a minimal,
// stable CSS selector for each one. The selectors are returned so popup.js
// can persist them in chrome.storage.local for use on future visits.

function learnSelectors(aiData) {
  const { title, company, description } = aiData;

  // Build a minimal selector for a single element.
  // We prefer ARIA labels and IDs (stable), then class fragments that look
  // semantic (not obfuscated hashes like "e6590096"), then tag + nth-of-type.
  function buildSelector(el) {
    if (!el) return null;

    // id is always unique and stable
    if (el.id && !/^\d/.test(el.id)) return `#${CSS.escape(el.id)}`;

    // aria-label on the element itself
    const aria = el.getAttribute("aria-label");
    if (aria) {
      const tag = el.tagName.toLowerCase();
      return `${tag}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
    }

    // Build a chain: tag + meaningful class fragments, scoped from nearest
    // landmark ancestor (section / article / main / [role]) downward.
    const classStr = el.className || "";
    const classes = typeof classStr === "string"
      ? classStr.split(/\s+/).filter(c =>
          c.length > 3 &&           // skip tiny utility classes
          !/^[a-f0-9]{6,}$/i.test(c) &&  // skip hex hashes
          !/^\d/.test(c)            // skip purely numeric
        )
      : [];

    const tag = el.tagName.toLowerCase();
    if (classes.length) {
      // Use up to the first 2 meaningful class fragments
      const clsSel = classes.slice(0, 2).map(c => `[class*="${c}"]`).join("");
      const candidate = `${tag}${clsSel}`;
      // Verify it matches exactly this element (no collision)
      try {
        if (document.querySelector(candidate) === el) return candidate;
      } catch { /* fallthrough */ }
    }

    // Walk up to find a stable ancestor selector then describe el relative to it
    const landmarks = ["section", "article", "main", "[role='main']", "[role='region']"];
    for (const lm of landmarks) {
      const ancestor = el.closest(lm);
      if (ancestor) {
        const ancSel = buildSelector(ancestor);
        if (ancSel) {
          // Relative path: use tag or tag+class inside ancestor
          const rel = classes.length
            ? `${tag}[class*="${classes[0]}"]`
            : tag;
          const combined = `${ancSel} ${rel}`;
          try {
            if (document.querySelector(combined) === el) return combined;
          } catch { /* fallthrough */ }
        }
      }
    }

    return null; // could not build a reliable selector
  }

  // Find the DOM element whose innerText best matches a known value
  function findElementByText(value, candidates) {
    if (!value || value.length < 3) return null;
    const needle = value.trim().slice(0, 120).toLowerCase();

    for (const sel of candidates) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const t = el.innerText?.trim().toLowerCase() ?? "";
          if (t === needle || t.startsWith(needle) || t.includes(needle)) {
            return el;
          }
        }
      } catch { /* skip bad selector */ }
    }
    return null;
  }

  // Candidate tags/selectors to search within for each field
  const titleCandidates  = ["h1", "h2", "h3", "a", "[class*='title']", "[class*='job-card']"];
  const companyCandidates = ["a[href*='/company/']", "span", "a", "[class*='company']", "[class*='org']"];
  const descCandidates   = [
    "section", "article", "div", "#job-details",
    "[class*='description']", "[class*='details']",
    "[class*='html-content']", "[class*='rich-text']",
  ];

  const learned = {};

  const titleEl = findElementByText(title, titleCandidates);
  if (titleEl) {
    const sel = buildSelector(titleEl);
    if (sel) learned.title = sel;
  }

  const companyEl = findElementByText(company, companyCandidates);
  if (companyEl) {
    const sel = buildSelector(companyEl);
    if (sel) learned.company = sel;
  }

  // For description we only need the first 80 chars to match
  const descShort = description?.trim().slice(0, 80) ?? "";
  const descEl = findElementByText(descShort, descCandidates);
  if (descEl) {
    const sel = buildSelector(descEl);
    if (sel) learned.description = sel;
  }

  // Tag what page type these selectors came from so we can use them
  // only on the right page layout next time
  const href = window.location.href;
  learned._pageType = /\/jobs\/view\//.test(href) ? "detail" : "search";
  learned._learnedAt = Date.now();

  return learned;
}

// ─── Use previously learned selectors (injected by popup.js) ─────────────
// popup.js sets window.__resumeTrackerLearnedSelectors before calling extract.

function extractWithLearnedSelectors(learned) {
  if (!learned) return null;
  const result = {};

  for (const field of ["title", "company", "description"]) {
    const sel = learned[field];
    if (!sel) continue;
    try {
      const el = document.querySelector(sel);
      const t = el?.innerText?.trim();
      if (t && t.length > (field === "description" ? 50 : 1)) {
        result[field] = t;
      }
    } catch { /* selector may have become invalid */ }
  }

  return result;
}

// ─── Page-text extractor for AI fallback ─────────────────────────────────
// Grabs the cleanest visible text available — preferring the job detail panel
// so the AI receives focused, relevant content rather than the whole page.
function getJobPageText() {
  // Priority order: right-side detail panel → full main area → full body
  const panel =
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.jobs-search-two-pane__detail-view') ||
    document.querySelector('[class*="jobs-search-two-pane__detail"]') ||
    document.querySelector('[class*="job-details"]') ||
    document.querySelector('.scaffold-layout__detail') ||
    document.querySelector('main') ||
    document.body;

  // innerText respects CSS visibility (display:none elements are excluded)
  const raw = panel?.innerText ?? document.body.innerText;

  // Collapse excessive blank lines so the AI token budget is used well
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 12000); // ~3k tokens max — enough for any job posting
}

window.__resumeTrackerExtract        = extractLinkedInJob;
window.__resumeTrackerExtractAsync   = extractLinkedInJobWithRetry;
window.__resumeTrackerGetPageText    = getJobPageText;
window.__resumeTrackerLearnSelectors = learnSelectors;
