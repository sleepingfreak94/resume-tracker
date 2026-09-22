// Job-scoped preparation shared by the popup and its regression tests.
(function (global) {
  function postingId(value) {
    try {
      const url = new URL(value);
      if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
      return url.pathname.match(/\/jobs\/view\/(\d+)/i)?.[1]
        || (/^\d+$/.test(url.searchParams.get("currentJobId") || "") ? url.searchParams.get("currentJobId") : null);
    } catch { return null; }
  }

  function matchingJob(jobs, linkedInJobId) {
    const matches = jobs.filter((job) => postingId(job.job_link) === linkedInJobId);
    if (matches.length > 1) throw new Error("Multiple tracked jobs match this LinkedIn posting. Resolve the duplicate jobs before uploading.");
    return matches[0] || null;
  }

  function statusMatches(status, context) {
    return Boolean(status && context && status.tabId === context.tabId &&
      status.linkedInJobId === context.linkedInJobId && Number(status.jobId) === Number(context.jobId) && status.port === context.port);
  }

  function createPreparer({ api, extract, currentUrl, bind, progress, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
    const inFlight = new Map();
    async function prepare({ tabId, tabUrl, port }) {
      const linkedInJobId = postingId(tabUrl);
      if (!linkedInJobId) throw new Error("Select a LinkedIn job before starting Smart Auto-Fill.");
      const key = `${port}:${tabId}:${linkedInJobId}`;
      if (inFlight.has(key)) return inFlight.get(key);
      const work = (async () => {
        const assertCurrent = async () => {
          if (postingId(await currentUrl(tabId)) !== linkedInJobId) {
            throw new Error("The LinkedIn job changed during résumé preparation. Nothing was uploaded; start again on the intended job.");
          }
        };
        const request = (path, options) => api(port, path, options);
        await assertCurrent();
        progress("Matching the selected LinkedIn job…");
        let job = matchingJob(await request("/api/jobs"), linkedInJobId);
        if (!job) {
          progress("Importing this job before creating its résumé…");
          const extracted = await extract(tabId);
          await assertCurrent();
          if (postingId(extracted?.url || extracted?.job_link) !== linkedInJobId ||
              !String(extracted?.title || "").trim() || !String(extracted?.company || "").trim() ||
              String(extracted?.description || "").trim().length < 200) {
            throw new Error("Could not verify the current job's title, company, and full description. Reopen the extension after the job details load.");
          }
          try {
            job = await request("/api/jobs", { method: "POST", body: {
              title: extracted.title.trim(), company: extracted.company.trim(), description: extracted.description.trim(),
              job_link: `https://www.linkedin.com/jobs/view/${linkedInJobId}`,
            } });
          } catch (error) {
            if (error.status !== 409) throw error;
            job = matchingJob(await request("/api/jobs"), linkedInJobId);
            if (!job) throw error;
          }
        }
        if (!Number.isInteger(job?.id) || postingId(job.job_link) !== linkedInJobId) throw new Error("The tracked job does not match the selected LinkedIn posting.");
        if (job.status === "applied") throw new Error("This job is already marked Applied. No new résumé upload was attempted.");
        await assertCurrent();
        let artifact = await request(`/api/resume/tailored/${job.id}`);
        const ready = () => job.status === "ready" && Boolean(job.tailored_resume_path && artifact?.exists && artifact?.content?.trim());
        if (!ready()) {
          progress(`Creating a tailored résumé for ${job.company} — ${job.title}. Keep this popup open…`);
          if (job.status !== "generating") {
            try {
              const generated = await request(`/api/tailor/${job.id}`, { method: "POST" });
              if (!generated?.success) throw new Error(generated?.error || "Résumé generation failed. Nothing was uploaded.");
            } catch (error) {
              if (error.status !== 409) throw error;
            }
          }
          const deadline = now() + 5 * 60_000;
          do {
            await assertCurrent();
            job = await request(`/api/jobs/${job.id}`);
            if (job.status !== "generating") break;
            if (now() >= deadline) throw new Error("Résumé generation is still in progress. Nothing was uploaded; check the tracker before retrying.");
            await wait(1000);
          } while (true);
          artifact = await request(`/api/resume/tailored/${job.id}`);
        }
        if (!ready() || postingId(job.job_link) !== linkedInJobId) throw new Error("A verified tailored résumé for this job is not ready. Nothing was uploaded.");
        await assertCurrent();
        await bind({ tabId, linkedInJobId, jobId: job.id, port });
        progress(`Tailored résumé ready for ${job.company}. Preparing the upload…`);
        return job;
      })();
      inFlight.set(key, work);
      try { return await work; } finally { inFlight.delete(key); }
    }
    return { prepare };
  }
  global.ResumeTrackerSmartResume = { postingId, matchingJob, statusMatches, createPreparer };
})(globalThis);
