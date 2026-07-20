// Runs in the LinkedIn page context to extract job details from the DOM.
// Handles both full job pages (/jobs/view/...) and the search/feed preview panels.
// Uses polling to wait for dynamically loaded content.

function cleanJobField(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isLinkedInUiHeading(value) {
  return /^(use ai|show match|tailor my resume|help me stand out|job search faster|about the job|similar jobs|people also viewed)/i.test(
    cleanJobField(value)
  );
}

function htmlToPlainText(value, ownerDocument = document) {
  let html = String(value || "");
  // LinkedIn's JSON-LD HTML is entity-encoded, sometimes more than once.
  for (let i = 0; i < 2 && /&(?:lt|gt|amp|quot|#39);/i.test(html); i++) {
    const textarea = ownerDocument.createElement("textarea");
    textarea.innerHTML = html;
    html = textarea.value;
  }
  const container = ownerDocument.createElement("div");
  container.innerHTML = html;
  return (container.textContent || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findJobPosting(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (value["@type"] === "JobPosting") return value;
  if (Array.isArray(value["@graph"])) return findJobPosting(value["@graph"]);
  return null;
}

function extractStructuredJob(sourceDocument = document) {
  for (const script of sourceDocument.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const posting = findJobPosting(JSON.parse(script.textContent || "null"));
      if (!posting) continue;
      const organization = posting.hiringOrganization;
      const company = typeof organization === "string" ? organization : organization?.name;
      const title = cleanJobField(posting.title);
      const description = htmlToPlainText(posting.description, sourceDocument);
      if (title && description.length > 100) {
        return {
          title,
          company: cleanJobField(company),
          description,
          url: cleanLinkedInJobUrl(posting.url || ""),
        };
      }
    } catch {
      // Ignore unrelated or malformed structured-data blocks.
    }
  }
  return null;
}

function cleanLinkedInJobUrl(value) {
  const match = String(value || "").match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d+)/i);
  return match ? `https://www.linkedin.com/jobs/view/${match[1]}` : "";
}

function getSelectedSearchCard() {
  return (
    document.querySelector(".job-search-card--active") ||
    document.querySelector('[class*="job-card-container--active"]') ||
    document.querySelector('[class*="job-card"][aria-selected="true"]') ||
    document.querySelector('[class*="jobs-search-results__list-item--active"]') ||
    document.querySelector('li[class*="active"] .job-card-container') ||
    document.querySelector('[data-entity-urn*="jobPosting"][aria-current="true"]')
  );
}

function getFocusedJobPanel() {
  return (
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.jobs-search-two-pane__detail-view') ||
    document.querySelector('[class*="jobs-search-two-pane__detail"]') ||
    document.querySelector('[class*="job-details"]') ||
    document.querySelector('.scaffold-layout__detail')
  );
}

function getSelectedJobUrl() {
  const params = new URLSearchParams(window.location.search);
  const currentJobId = params.get("currentJobId");
  if (currentJobId && /^\d+$/.test(currentJobId)) {
    return `https://www.linkedin.com/jobs/view/${currentJobId}`;
  }
  const card = getSelectedSearchCard();
  const cardLink = card?.querySelector('a[href*="/jobs/view/"]');
  const cardUrl = cleanLinkedInJobUrl(cardLink?.href || "");
  if (cardUrl) return cardUrl;
  return cleanLinkedInJobUrl(window.location.href);
}

async function fetchSelectedJobDetails() {
  const url = getSelectedJobUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const html = await response.text();
    const sourceDocument = new DOMParser().parseFromString(html, "text/html");
    const structured = extractStructuredJob(sourceDocument);
    if (structured) return { ...structured, url };

    const title = cleanJobField(
      sourceDocument.querySelector("h1.topcard__title, h1[class*='top-card-layout__title']")?.textContent
    );
    const company = cleanJobField(
      sourceDocument.querySelector("a.topcard__org-name-link, a[class*='topcard__org-name-link']")?.textContent
    );
    const descriptionElement = sourceDocument.querySelector(
      ".show-more-less-html__markup, .description__text--rich, section.description"
    );
    const description = cleanJobField(descriptionElement?.textContent);
    return title && company && description.length > 100 ? { title, company, description, url } : null;
  } catch {
    return null;
  }
}

function extractLinkedInJob() {

  const pageStructured = /linkedin\.com\/jobs\/view\//.test(window.location.href)
    ? extractStructuredJob(document)
    : null;
  if (pageStructured?.title && pageStructured?.company && pageStructured.description?.length > 100) {
    return {
      ...pageStructured,
      url: cleanLinkedInJobUrl(window.location.href) || pageStructured.url || window.location.href.split("?")[0],
    };
  }

  // ── Try learned selectors first (saved from a previous AI fix) ───────────
  const learned = window.__resumeTrackerLearnedSelectors;
  if (learned) {
    const fromLearned = extractWithLearnedSelectors(learned);
    const selectedCard = getSelectedSearchCard();
    const selectedTitle = cleanJobField(
      selectedCard?.querySelector('.base-search-card__title, h3, [class*="job-card-list__title"], [class*="job-title"]')?.textContent
    );
    const selectedCompany = cleanJobField(
      selectedCard?.querySelector('.base-search-card__subtitle, h4, [class*="primary-description"], [class*="company"]')?.textContent
    );
    const learnedTitleMatches = !selectedTitle || cleanJobField(fromLearned?.title).toLowerCase() === selectedTitle.toLowerCase();
    const learnedCompanyMatches = !selectedCompany || cleanJobField(fromLearned?.company).toLowerCase() === selectedCompany.toLowerCase();
    const hasFocusedDetails = /\/jobs\/view\//.test(window.location.href) || Boolean(getFocusedJobPanel());
    const hasAll = fromLearned?.title && !isLinkedInUiHeading(fromLearned.title) &&
      learnedTitleMatches && learnedCompanyMatches && hasFocusedDetails &&
      fromLearned?.company && fromLearned?.description;
    if (hasAll) {
      const url = getSelectedJobUrl() || window.location.href.split("?")[0];
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
  const structuredJob = isJobDetailPage ? extractStructuredJob(document) : null;
  // ─────────────────────── active job card (search) ────────────────────────
  // On search pages the right panel shows the selected job. We try to scope
  // the extraction to that panel to avoid reading stale list-card data.

  const rightPanel = getFocusedJobPanel();

  // The selected/active card in the list pane — useful for title fallback
  const activeCard = getSelectedSearchCard();

  // ───────────────────────────── TITLE ─────────────────────────────────────

  let title = structuredJob?.title || "";

  // 1. Right panel h1 / h2 (job detail page & search panel)
  if (!title && rightPanel) {
    title = getText([
      '[class*="job-details-jobs-unified-top-card__job-title"] h1',
      '[class*="job-details-jobs-unified-top-card__job-title-link"]',
      '[class*="jobs-unified-top-card__job-title"]',
      'a[href*="/jobs/view/"][class*="job-title"]',
      'h1',
      'h2[class*="job-title"]',
    ], rightPanel);
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
        '.base-search-card__title',
        'h3',
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

  if (isLinkedInUiHeading(title)) title = "";

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

  let company = structuredJob?.company || "";

  // 1. Company link in right panel
  if (!company && rightPanel) {
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
        '.base-search-card__subtitle',
        'h4',
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

  let description = structuredJob?.description || "";

  // LinkedIn's current signed-in and public layouts both expose this focused
  // container. Prefer it before broad ARIA-labelled articles.
  if (!description) {
    const jd = document.querySelector('#job-details');
    if (jd?.innerText?.trim()?.length > 100) description = jd.innerText.trim();
  }

  // 1. Stable ARIA-labelled section — works on both page types
  const ariaDescSelectors = [
    'section[aria-label*="About the job" i]',
    'section[aria-label*="Job description" i]',
    'section[aria-label*="description" i]',
    '[aria-label*="job description" i]',
    'article[aria-label*="job" i]',
  ];
  if (!description) {
    for (const sel of ariaDescSelectors) {
      const el = document.querySelector(sel);
      if (el?.innerText?.trim()?.length > 100) { description = el.innerText.trim(); break; }
    }
  }

  // 2. Right-panel rich-text content blocks
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

  // 3. Same candidates without panel scoping
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

  // 4. Longest div inside right panel (last resort)
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

  let url = structuredJob?.url || window.location.href;
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
    const link = activeCard?.querySelector('a[href*="/jobs/view/"]') ||
      document.querySelector('[class*="active"] a[href*="/jobs/view/"]') ||
      document.querySelector('[aria-selected="true"] a[href*="/jobs/view/"]') ||
      document.querySelector('a[href*="/jobs/view/"]');
    const m = link?.href?.match(/\/jobs\/view\/(\d+)/);
    if (m) jobId = m[1];
  }

  if (jobId) {
    url = `https://www.linkedin.com/jobs/view/${jobId}`;
  } else if (url.includes("/jobs/view/")) {
    url = cleanLinkedInJobUrl(url) || url.split("?")[0];
  } else if (!isJobDetailPage) {
    // Public search-card links include the job title before the numeric ID.
    // Normalize that selected link instead of returning the search-page URL.
    url = getSelectedJobUrl() || url;
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

    // Search-result pages sometimes render only cards, with no description
    // panel. Read the selected job's public detail page instead of sending the
    // entire results page to AI, which can confuse LinkedIn UI with the title.
    if (!/\/jobs\/view\//.test(window.location.href) && i === 0) {
      const fetched = await fetchSelectedJobDetails();
      if (fetched) {
        return {
          title: fetched.title || result.title,
          company: fetched.company || result.company,
          description: fetched.description || result.description,
          url: fetched.url || result.url,
        };
      }
    }

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
  // On a card-only search page, keep the AI fallback scoped to the selected
  // card. Sending every search result is what caused UI headings and unrelated
  // jobs to be mistaken for the designation.
  const focusedPanel = getFocusedJobPanel();
  const selectedCard = getSelectedSearchCard();
  const isSearchPage = /linkedin\.com\/jobs\/search\//.test(window.location.href);
  const panel = focusedPanel ||
    (isSearchPage && selectedCard ? selectedCard : null) ||
    document.querySelector('main') ||
    document.body;

  // innerText respects CSS visibility (display:none elements are excluded)
  const raw = panel?.innerText ?? document.body.innerText;
  const selectedUrl = isSearchPage ? getSelectedJobUrl() : "";

  // Collapse excessive blank lines so the AI token budget is used well
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 12000); // ~3k tokens max — enough for any job posting
  return selectedUrl ? `${cleaned}\n\nJob URL: ${selectedUrl}` : cleaned;
}

window.__resumeTrackerExtract        = extractLinkedInJob;
window.__resumeTrackerExtractAsync   = extractLinkedInJobWithRetry;
window.__resumeTrackerGetPageText    = getJobPageText;
window.__resumeTrackerLearnSelectors = learnSelectors;
