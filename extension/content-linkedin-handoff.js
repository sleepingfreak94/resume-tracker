// Minimal declarative handoff for Dashboard Auto Apply links. It runs before
// LinkedIn can rewrite the URL fragment and does nothing without that handoff.
(function () {
  function dashboardHandoffFromUrl(value) {
    try {
      const url = new URL(value);
      const params = new URLSearchParams(url.hash.replace(/^#/, ""));
      const jobId = Number(params.get("rt_job_id"));
      const port = Number(params.get("resume-tracker-port") || 3000);
      if (!Number.isInteger(jobId) || jobId <= 0 || !Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { jobId, port };
    } catch {
      return null;
    }
  }

  if (window.__RT_LINKEDIN_HANDOFF_TEST__) {
    window.__rtLinkedInHandoffTest = { dashboardHandoffFromUrl };
    return;
  }

  const handoff = dashboardHandoffFromUrl(window.location.href);
  if (handoff) chrome.runtime.sendMessage({ type: "DASHBOARD_AUTOFILL_HANDOFF", ...handoff }).catch(() => {});
})();
