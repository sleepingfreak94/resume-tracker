import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

type Job = { id: number; job_link: string; company: string; title: string; status: string; tailored_resume_path?: string };
type Options = { method?: string; body?: unknown };
type Context = { tabId: number; linkedInJobId: string; jobId: number; port: number };
type Module = {
  postingId: (url: string) => string | null;
  matchingJob: (jobs: Job[], id: string) => Job | null;
  statusMatches: (status: Context | null, context: Context | null) => boolean;
  createPreparer: (deps: Record<string, unknown>) => { prepare: (input: { tabId: number; tabUrl: string; port: number }) => Promise<Job> };
};
function loadModule(): Module {
  const context = vm.createContext({ URL, Date, setTimeout });
  vm.runInContext(fs.readFileSync("extension/smart-resume.js", "utf8"), context);
  return context.ResumeTrackerSmartResume;
}
const url = "https://www.linkedin.com/jobs/search/?currentJobId=4464124018";
const input = { tabId: 17, tabUrl: url, port: 3000 };
function fixture() {
  const smartResume = loadModule();
  const job: Job = { id: 112, job_link: "https://www.linkedin.com/jobs/view/4464124018", title: "Quality Specialist", company: "RAMPF", status: "pending" };
  const oldJob: Job = { ...job, id: 111, job_link: "https://www.linkedin.com/jobs/view/4463498718", company: "Other employer", status: "applied" };
  const state = { jobs: [oldJob], currentUrl: url, exists: false, content: "", generationFails: false, changedWhileGenerating: false, extractedUrl: job.job_link };
  const calls: string[] = [];
  const bindings: Context[] = [];
  const deps = {
    api: async (_port: number, path: string, options?: Options): Promise<unknown> => {
      calls.push(`${options?.method || "GET"} ${path}`);
      if (path === "/api/jobs" && options?.method === "POST") {
        assert.equal((options.body as Job).job_link, job.job_link);
        state.jobs.push(job);
        return job;
      }
      if (path === "/api/jobs") return state.jobs;
      if (path === "/api/jobs/112") return job;
      if (path === "/api/resume/tailored/112") return { exists: state.exists, content: state.content };
      if (path === "/api/tailor/112") {
        if (state.changedWhileGenerating) state.currentUrl = oldJob.job_link;
        if (state.generationFails) return { success: false, error: "AI generation failed" };
        job.status = "ready";
        job.tailored_resume_path = "/resumes/tailored/job-112.md";
        state.exists = true;
        state.content = "# Tailored RAMPF résumé";
        return { success: true };
      }
      throw new Error(`Unexpected endpoint ${path}`);
    },
    extract: async () => ({ ...job, url: state.extractedUrl, description: "Verified current job description. ".repeat(12) }),
    currentUrl: async () => state.currentUrl,
    bind: async (context: Context) => { bindings.push(context); calls.push("bind"); },
    progress: () => {},
  };
  return { module: smartResume, job, oldJob, state, calls, bindings, deps };
}

test("Smart Auto-Fill imports the current job, creates and verifies its résumé before binding it for upload", async () => {
  const f = fixture();
  const result = await f.module.createPreparer(f.deps).prepare(input);
  assert.equal(result.id, 112);
  assert.deepEqual(f.calls, ["GET /api/jobs", "POST /api/jobs", "GET /api/resume/tailored/112", "POST /api/tailor/112", "GET /api/jobs/112", "GET /api/resume/tailored/112", "bind"]);
  assert.equal(f.bindings[0].jobId, 112);
  assert.equal(f.bindings[0].linkedInJobId, "4464124018");
  assert.ok(!f.calls.some((call) => call.includes("/111")));
});

test("Smart Auto-Fill reuses only a verified ready artifact for the matching job", async () => {
  const f = fixture();
  f.state.jobs.push(f.job);
  Object.assign(f.job, { status: "ready", tailored_resume_path: "/resume.md" });
  Object.assign(f.state, { exists: true, content: "Ready résumé" });
  await f.module.createPreparer(f.deps).prepare(input);
  assert.deepEqual(f.calls, ["GET /api/jobs", "GET /api/resume/tailored/112", "bind"]);
});

test("Smart Auto-Fill regenerates a missing or empty artifact even when the job says ready", async () => {
  for (const content of ["", "   "]) {
    const f = fixture();
    f.state.jobs.push(f.job);
    Object.assign(f.job, { status: "ready", tailored_resume_path: "/resume.md" });
    Object.assign(f.state, { exists: true, content });
    await f.module.createPreparer(f.deps).prepare(input);
    assert.ok(f.calls.includes("POST /api/tailor/112"));
  }
});

test("generation failure or job navigation cannot bind a résumé for upload", async () => {
  for (const mode of ["generationFails", "changedWhileGenerating"] as const) {
    const f = fixture();
    f.state[mode] = true;
    await assert.rejects(f.module.createPreparer(f.deps).prepare(input), /generation failed|job changed/i);
    assert.equal(f.bindings.length, 0);
  }
});

test("stale extracted details, applied jobs, and duplicate records stop before generation", async () => {
  for (const mode of ["stale", "applied", "duplicate"]) {
    const f = fixture();
    if (mode === "stale") f.state.extractedUrl = f.oldJob.job_link;
    else {
      f.state.jobs.push(f.job);
      if (mode === "applied") f.job.status = "applied";
      else f.state.jobs.push({ ...f.job, id: 113 });
    }
    await assert.rejects(f.module.createPreparer(f.deps).prepare(input), /verify|Applied|Multiple/);
    assert.equal(f.bindings.length, 0);
    assert.ok(!f.calls.includes("POST /api/tailor/112"));
  }
});

test("concurrent clicks share preparation and a concurrent import is resolved by posting ID", async () => {
  const f = fixture();
  const api = f.deps.api;
  f.deps.api = async (port, path, options) => {
    if (path === "/api/jobs" && options?.method === "POST") {
      f.state.jobs.push(f.job);
      throw Object.assign(new Error("Already tracked"), { status: 409 });
    }
    return api(port, path, options);
  };
  const preparer = f.module.createPreparer(f.deps);
  const results = await Promise.all([preparer.prepare(input), preparer.prepare(input)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(f.calls.filter((call) => call === "POST /api/tailor/112").length, 1);
});

test("an in-progress generation is awaited without starting a second generation", async () => {
  const f = fixture();
  f.state.jobs.push(f.job);
  f.job.status = "generating";
  await f.module.createPreparer({ ...f.deps, wait: async () => {
    f.job.status = "ready";
    f.job.tailored_resume_path = "/resume.md";
    f.state.exists = true;
    f.state.content = "Ready";
  } }).prepare(input);
  assert.ok(!f.calls.includes("POST /api/tailor/112"));
  assert.equal(f.bindings.length, 1);
});

test("a successful generation response without a valid artifact still blocks upload", async () => {
  const f = fixture();
  const api = f.deps.api;
  f.deps.api = async (port, path, options) => path === "/api/tailor/112" ? { success: true } : api(port, path, options);
  await assert.rejects(f.module.createPreparer(f.deps).prepare(input), /not ready/);
  assert.equal(f.bindings.length, 0);
});

test("status belongs to the same tab, posting, and tracked job; arbitrary hosts are not LinkedIn", () => {
  const smartResume = loadModule();
  const context = { tabId: 17, linkedInJobId: "4464124018", jobId: 112, port: 3000 };
  assert.equal(smartResume.statusMatches(context, context), true);
  for (const status of [null, { ...context, tabId: 18 }, { ...context, linkedInJobId: "4463498718" }, { ...context, jobId: 111 }]) {
    assert.equal(smartResume.statusMatches(status, context), false);
  }
  assert.equal(smartResume.postingId("https://example.com/jobs/view/4464124018"), null);
});

test("the real popup waits for preparation, ignores stale job IDs, and uploads only the prepared job", async () => {
  const smartResume = loadModule();
  const source = fs.readFileSync("extension/popup.js", "utf8");
  const start = source.indexOf("async function runAutoApply(");
  const end = source.indexOf('$("fill-btn").addEventListener', start);
  for (const fail of [false, true]) {
    const events: string[] = [];
    const uploads: Array<{ jobId: number }> = [];
    const statuses: string[] = [];
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const context = vm.createContext({
      activeResumeContext: null,
      $: () => ({ disabled: false }), getPort: () => 3000,
      linkedInPostingIdFromUrl: smartResume.postingId,
      smartResumePreparer: { prepare: async () => {
        events.push("preparing");
        await pending;
        if (fail) throw new Error("Generation failed");
        events.push("ready");
        return { id: 112 };
      } },
      uploadLinkedInResumeFromPopup: async (request: { jobId: number }) => {
        events.push("upload"); uploads.push(request); return { ok: true };
      },
      refreshResumeUploadStatus: async () => {},
      showStatus: (message: string) => { statuses.push(message); },
      chrome: { tabs: {
        query: async () => [{ id: 17, url: `${url}#rt_job_id=111` }],
        get: async () => ({ id: 17, url }),
      }, storage: { local: { get: async () => { throw new Error("Must not use the stale global job ID"); } } } },
    });
    vm.runInContext(source.slice(start, end), context);
    const run = vm.runInContext("runAutoApply(false)", context);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(events, ["preparing"]);
    assert.equal(uploads.length, 0);
    release();
    await run;
    if (fail) {
      assert.equal(uploads.length, 0);
      assert.ok(statuses.includes("Generation failed"));
    } else {
      assert.deepEqual(events, ["preparing", "ready", "upload"]);
      assert.equal(uploads[0].jobId, 112);
    }
  }
});
