import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";

class MockEvent {
  listeners = new Set<(...args: unknown[]) => void>();
  addListener = (listener: (...args: unknown[]) => void) => { this.listeners.add(listener); };
  removeListener = (listener: (...args: unknown[]) => void) => { this.listeners.delete(listener); };
  emit(...args: unknown[]) { for (const listener of [...this.listeners]) listener(...args); }
}

type Command = {
  target: { tabId?: number; sessionId?: string };
  method: string;
  params: Record<string, unknown>;
};

function pending<T = never>(): Promise<T> {
  return new Promise(() => {});
}

function createChromeMock() {
  const downloadChanged = new MockEvent();
  const debuggerEvent = new MockEvent();
  const debuggerDetach = new MockEvent();
  const commands: Command[] = [];
  const downloads: Array<Record<string, unknown>> = [];
  const sessionStore = new Map<string, unknown>();
  let attachCalls = 0;
  let detachCalls = 0;
  let downloadState: Record<string, unknown> = {
    id: 41,
    state: "complete",
    filename: "/Users/test/Downloads/ResumeTracker/Uploads/66/KshitijSharma-Resume.docx",
  };
  let attachImpl: () => Promise<void> = async () => {};
  let detachImpl: () => Promise<void> = async () => {};
  let commandImpl: ((command: Command) => Promise<unknown>) | null = null;
  let emitChooser = true;

  const defaultCommand = async ({ target, method, params }: Command) => {
    if (method === "DOM.getDocument") return { root: { nodeId: 1 } };
    if (method === "DOM.performSearch") return { searchId: "search-1", resultCount: 1 };
    if (method === "DOM.getSearchResults") return { nodeIds: [7] };
    if (method === "DOM.getBoxModel") {
      return { model: { border: [100, 200, 300, 200, 300, 260, 100, 260] } };
    }
    if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased" && emitChooser) {
      debuggerEvent.emit(
        { tabId: target.tabId, sessionId: "chooser-session" },
        "Page.fileChooserOpened",
        { backendNodeId: 91, frameId: "frame-1", mode: "selectSingle" },
      );
    }
    return {};
  };

  const chromeMock = {
    downloads: {
      onChanged: downloadChanged,
      download: async (options: Record<string, unknown>) => {
        downloads.push(options);
        return 41;
      },
      search: async () => [downloadState],
    },
    debugger: {
      onEvent: debuggerEvent,
      onDetach: debuggerDetach,
      attach: async () => { attachCalls++; return attachImpl(); },
      detach: async () => { detachCalls++; return detachImpl(); },
      sendCommand: async (target: Command["target"], method: string, params: Record<string, unknown> = {}) => {
        const command = { target, method, params };
        commands.push(command);
        return commandImpl ? commandImpl(command) : defaultCommand(command);
      },
    },
    storage: {
      session: {
        get: async (keys: string | string[]) => {
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(wanted.filter((key) => sessionStore.has(key)).map((key) => [key, sessionStore.get(key)]));
        },
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) sessionStore.set(key, value);
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(key);
        },
      },
    },
    state: {
      commands,
      downloads,
      sessionStore,
      downloadChanged,
      debuggerEvent,
      debuggerDetach,
      defaultCommand,
      get attachCalls() { return attachCalls; },
      get detachCalls() { return detachCalls; },
      setDownloadState(value: Record<string, unknown>) { downloadState = value; },
      setAttachImpl(value: () => Promise<void>) { attachImpl = value; },
      setDetachImpl(value: () => Promise<void>) { detachImpl = value; },
      setCommandImpl(value: ((command: Command) => Promise<unknown>) | null) { commandImpl = value; },
      setEmitChooser(value: boolean) { emitChooser = value; },
    },
  };
  return chromeMock;
}

type ChromeMock = ReturnType<typeof createChromeMock>;

type UploadResponse = {
  ok: boolean;
  filename: string | null;
  method: "chooser";
  cdpStatus: string;
  stage: string;
  attemptId: string | null;
  duplicatePrevented?: boolean;
  cleanupWarnings?: string[];
  failure: { reason: string; message: string; stage: string } | null;
};

type UploadStatus = {
  stage: string;
  failedStage?: string;
  filename: string | null;
  fileSet: boolean;
  ambiguous: boolean;
  terminal: boolean;
  history: Array<{ stage: string; at: number }>;
};

type Controller = {
  upload: (message: Record<string, unknown>, sender: Record<string, unknown>) => Promise<UploadResponse>;
  getLatestStatus: (request: { tabId: number }) => Promise<UploadStatus | null>;
  clearLatestStatus: (request: { tabId: number }) => Promise<{ ok: boolean; cleared: boolean; failure?: { reason: string } }>;
};

type ResumeCdpModule = {
  CONTROLLER_VERSION: string;
  createResumeCdpController: (options: Record<string, unknown>) => Controller;
};

function loadResumeCdpModule(): ResumeCdpModule {
  const source = fs.readFileSync(path.join(process.cwd(), "extension", "resume-cdp.js"), "utf8");
  const context = vm.createContext({
    console, setTimeout, clearTimeout, URL, Error, Promise, Math, Date,
    AbortController, Response, Blob,
  });
  vm.runInContext(source, context);
  return (context as unknown as { ResumeTrackerCdp: ResumeCdpModule }).ResumeTrackerCdp;
}

function createFetchMock() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/api/profile")) {
      return new Response(JSON.stringify({ first_name: "Kshitij", last_name: "Sharma" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/resume/tailored/66")) {
      return new Response(JSON.stringify({ exists: true, content: "# Tailored résumé" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/resume/docx")) return new Response(new Uint8Array([1, 2, 3]));
    return new Response("Not found", { status: 404 });
  };
  return { fetchMock: fetchMock as typeof fetch, calls };
}

const TEST_TIMEOUTS = {
  fetch: 30,
  document: 30,
  download: 40,
  attach: 15,
  command: 15,
  chooser: 15,
  validation: 20,
  cleanup: 8,
  storage: 15,
  total: 300,
};

function makeController(
  chromeMock: ChromeMock,
  options: {
    fetchImpl?: typeof fetch;
    validateAcceptance?: (details: Record<string, unknown>) => Promise<Record<string, unknown>>;
    onStage?: (status: UploadStatus) => void;
    timeouts?: Partial<typeof TEST_TIMEOUTS>;
  } = {},
) {
  const resumeCdp = loadResumeCdpModule();
  const defaultFetch = createFetchMock();
  const controller = resumeCdp.createResumeCdpController({
    chromeApi: chromeMock,
    fetchImpl: options.fetchImpl || defaultFetch.fetchMock,
    toDataUrl: async () => "data:application/octet-stream;base64,AQID",
    validateAcceptance: options.validateAcceptance || (async () => ({ accepted: true, filenamePresent: true, requiredErrorVisible: false })),
    onStage: options.onStage,
    timeouts: { ...TEST_TIMEOUTS, ...options.timeouts },
    timers: globalThis,
  });
  return { controller, fetchCalls: defaultFetch.calls, version: resumeCdp.CONTROLLER_VERSION };
}

const validMessage = {
  port: 3002,
  jobId: 66,
  format: "docx",
  targetToken: "rt_active_upload_1234567890",
  attemptId: "rt_attempt_123456789012345",
  linkedInJobId: "123",
};
const validSender = { frameId: 23, tab: { id: 17, url: "https://www.linkedin.com/jobs/view/123" } };

test("chooser-first CDP upload clicks the marked visible control and assigns one downloaded file", async () => {
  const chromeMock = createChromeMock();
  const stages: string[] = [];
  const validationDetails: Record<string, unknown>[] = [];
  const { controller, fetchCalls, version } = makeController(chromeMock, {
    onStage: (status) => stages.push(status.stage),
    validateAcceptance: async (details) => {
      validationDetails.push(details);
      return { accepted: true, filenamePresent: true, requiredErrorVisible: false };
    },
  });
  const result = await controller.upload(validMessage, validSender);

  assert.equal(version, "3.6.1");
  assert.equal(result.ok, true);
  assert.equal(result.method, "chooser");
  assert.equal(result.cdpStatus, "validated");
  assert.equal(result.filename, "KshitijSharma-Resume.docx");
  assert.equal(chromeMock.state.downloads.length, 1);
  assert.equal(chromeMock.state.downloads[0].filename, "ResumeTracker/Uploads/66/KshitijSharma-Resume.docx");
  assert.equal(chromeMock.state.downloads[0].conflictAction, "overwrite");
  assert.equal(fetchCalls.filter(({ url }) => url.endsWith("/api/resume/docx")).length, 1);
  assert.equal(validationDetails[0]?.frameId, 23);

  const query = chromeMock.state.commands.find(({ method }) => method === "DOM.performSearch");
  assert.equal(query?.params.query, '[data-rt-cdp-upload-token="rt_active_upload_1234567890"]');
  assert.equal(query?.params.includeUserAgentShadowDOM, true);
  assert.ok(chromeMock.state.commands.some(({ method }) => method === "DOM.discardSearchResults"));
  const clicks = chromeMock.state.commands.filter(({ method }) => method === "Input.dispatchMouseEvent");
  assert.deepEqual(clicks.map(({ params }) => [params.type, params.x, params.y]), [
    ["mousePressed", 200, 230],
    ["mouseReleased", 200, 230],
  ]);
  const assignments = chromeMock.state.commands.filter(({ method }) => method === "DOM.setFileInputFiles");
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].params.backendNodeId, 91);
  assert.equal(assignments[0].params.nodeId, undefined);
  assert.deepEqual(Array.from(assignments[0].params.files as string[]), ["/Users/test/Downloads/ResumeTracker/Uploads/66/KshitijSharma-Resume.docx"]);
  assert.deepEqual(
    chromeMock.state.commands.filter(({ method }) => method === "Page.setInterceptFileChooserDialog").map(({ params }) => params.enabled),
    [true, false],
  );
  assert.ok(stages.includes("file_set_pending"));
  assert.equal(stages.at(-1), "validated");
  assert.equal(chromeMock.state.attachCalls, 1);
  assert.equal(chromeMock.state.detachCalls, 1);
  assert.equal(chromeMock.state.downloadChanged.listeners.size, 0);
  assert.equal(chromeMock.state.debuggerEvent.listeners.size, 0);
  assert.equal(chromeMock.state.debuggerDetach.listeners.size, 0);
});

test("accessibility-targeted popup upload reaches LinkedIn's non-DOM résumé dialog and validates the selected card", async () => {
  const chromeMock = createChromeMock();
  let accessibilityCalls = 0;
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "Accessibility.getFullAXTree") {
      accessibilityCalls++;
      if (accessibilityCalls === 1) {
        return {
          nodes: [{ ignored: false, backendDOMNodeId: 501, role: { value: "button" }, name: { value: "Upload resume button. Only DOC, DOCX, PDF formats are supported." } }],
        };
      }
      return {
        nodes: [
          { ignored: false, role: { value: "heading" }, name: { value: "KshitijSharma-Resume.docx" } },
          { ignored: false, role: { value: "radio" }, name: { value: "Deselect resume KshitijSharma-Resume.docx" }, properties: [{ name: "checked", value: { value: true } }] },
        ],
      };
    }
    return chromeMock.state.defaultCommand(command);
  });
  let contentValidationCalls = 0;
  const { controller } = makeController(chromeMock, {
    validateAcceptance: async () => {
      contentValidationCalls++;
      return { accepted: false };
    },
  });
  const result = await controller.upload(
    { ...validMessage, tabId: 17, targetToken: undefined },
    { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
  );

  assert.equal(result.ok, true);
  assert.equal(result.cdpStatus, "validated");
  assert.equal(accessibilityCalls >= 2, true);
  assert.equal(contentValidationCalls, 0);
  assert.equal(chromeMock.state.downloads.length, 1);
  assert.equal(chromeMock.state.commands.some(({ method }) => method === "DOM.performSearch"), false);
  const bounds = chromeMock.state.commands.find(({ method }) => method === "DOM.getBoxModel");
  assert.equal(bounds?.params.backendNodeId, 501);
  assert.equal(chromeMock.state.commands.filter(({ method }) => method === "DOM.setFileInputFiles").length, 1);
  assert.equal(chromeMock.state.detachCalls, 1);
});

test("accessibility target probe misses a non-resume step without generating or persisting an upload", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "Accessibility.getFullAXTree") return { nodes: [] };
    return chromeMock.state.defaultCommand(command);
  });
  const { controller } = makeController(chromeMock);
  const result = await controller.upload(
    { ...validMessage, tabId: 17, targetToken: undefined },
    { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
  );

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "input_not_found");
  assert.equal(result.stage, "accessibility_target");
  assert.equal(chromeMock.state.downloads.length, 0);
  assert.equal(chromeMock.state.sessionStore.size, 0);
  assert.equal(chromeMock.state.detachCalls, 1);
});

test("an uploaded but unselected DOCX card is clicked once and validated without a second file assignment", async () => {
  const chromeMock = createChromeMock();
  const stages: string[] = [];
  let accessibilityCalls = 0;
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "Accessibility.getFullAXTree") {
      accessibilityCalls++;
      if (accessibilityCalls === 1) {
        return {
          nodes: [{ ignored: false, backendDOMNodeId: 501, role: { value: "button" }, name: { value: "Upload resume button. Only DOC, DOCX, PDF formats are supported." } }],
        };
      }
      if (accessibilityCalls === 2) {
        return {
          nodes: [
            { ignored: false, role: { value: "heading" }, name: { value: "KshitijSharma-Resume.docx" } },
            { ignored: false, backendDOMNodeId: 777, role: { value: "radio" }, name: { value: "Select resume KshitijSharma-Resume.docx" }, properties: [{ name: "checked", value: { value: false } }] },
          ],
        };
      }
      return {
        nodes: [
          { ignored: false, role: { value: "heading" }, name: { value: "KshitijSharma-Resume.docx" } },
          { ignored: false, backendDOMNodeId: 777, role: { value: "radio" }, name: { value: "Deselect resume KshitijSharma-Resume.docx" }, properties: [{ name: "checked", value: { value: true } }] },
        ],
      };
    }
    return chromeMock.state.defaultCommand(command);
  });
  const { controller } = makeController(chromeMock, { onStage: (status) => stages.push(status.stage) });
  const result = await controller.upload(
    { ...validMessage, tabId: 17, targetToken: undefined },
    { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
  );

  assert.equal(result.ok, true);
  assert.ok(stages.includes("selecting_resume"));
  assert.equal(chromeMock.state.commands.filter(({ method }) => method === "DOM.setFileInputFiles").length, 1);
  assert.equal(chromeMock.state.commands.filter(({ method, params }) => method === "DOM.getBoxModel" && params.backendNodeId === 777).length, 1);
  assert.equal(chromeMock.state.commands.filter(({ method }) => method === "Input.dispatchMouseEvent").length, 4);
  assert.equal(chromeMock.state.downloads.length, 1);
});

test("unresolved LinkedIn validation persists across a service-worker restart and blocks a second upload", async () => {
  const chromeMock = createChromeMock();
  let validationCalls = 0;
  const first = makeController(chromeMock, {
    validateAcceptance: async () => {
      validationCalls++;
      return { accepted: false, filenamePresent: true, requiredErrorVisible: true };
    },
  }).controller;
  const firstResult = await first.upload(validMessage, validSender);

  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.failure?.reason, "validation_unconfirmed");
  assert.equal(firstResult.cdpStatus, "file_set");
  assert.equal(validationCalls, 1);

  const restarted = makeController(chromeMock).controller;
  const secondResult = await restarted.upload({ ...validMessage, attemptId: "rt_attempt_second_123456" }, validSender);
  assert.equal(secondResult.ok, false);
  assert.equal(secondResult.failure?.reason, "duplicate_prevented");
  assert.equal(chromeMock.state.downloads.length, 1);
  assert.equal(chromeMock.state.commands.filter(({ method }) => method === "DOM.setFileInputFiles").length, 1);
  assert.equal(chromeMock.state.attachCalls, 1);
});

test("a validated attempt is idempotent after restart without another download or CDP command", async () => {
  const chromeMock = createChromeMock();
  const first = makeController(chromeMock).controller;
  const firstResult = await first.upload(validMessage, validSender);
  assert.equal(firstResult.ok, true);

  const restarted = makeController(chromeMock).controller;
  const secondResult = await restarted.upload({ ...validMessage, attemptId: "rt_attempt_second_123456" }, validSender);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.duplicatePrevented, true);
  assert.equal(chromeMock.state.downloads.length, 1);
  assert.equal(chromeMock.state.attachCalls, 1);
});

test("download interruption stops before debugger attach, cleans its listener, and permits explicit safe reset", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setDownloadState({ id: 41, state: "interrupted", error: "NETWORK_FAILED" });
  const { controller } = makeController(chromeMock);
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "download_failed");
  assert.equal(result.stage, "download_wait");
  assert.equal(chromeMock.state.attachCalls, 0);
  assert.equal(chromeMock.state.downloadChanged.listeners.size, 0);
  const status = await controller.getLatestStatus({ tabId: 17 });
  assert.equal(status?.stage, "needs_manual");
  assert.equal(status?.ambiguous, false);
  assert.deepEqual({ ...await controller.clearLatestStatus({ tabId: 17 }) }, { ok: true, cleared: true });
  assert.equal(await controller.getLatestStatus({ tabId: 17 }), null);
});

test("a hung tailored-resume request reaches a download_failed deadline without attaching", async () => {
  const chromeMock = createChromeMock();
  const base = createFetchMock();
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    if (String(input).includes("/api/resume/tailored/")) return pending<Response>();
    return base.fetchMock(input, init);
  }) as typeof fetch;
  const { controller } = makeController(chromeMock, { fetchImpl, timeouts: { fetch: 8 } });
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "download_failed");
  assert.equal(result.stage, "tailored_fetch");
  assert.equal(chromeMock.state.attachCalls, 0);
});

test("debugger attach timeout returns promptly and a late attach is detached", async () => {
  const chromeMock = createChromeMock();
  let releaseAttach!: () => void;
  chromeMock.state.setAttachImpl(() => new Promise<void>((resolve) => { releaseAttach = resolve; }));
  const { controller } = makeController(chromeMock, { timeouts: { attach: 6 } });
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "debugger_unavailable");
  assert.equal(result.stage, "debugger_attach");
  assert.equal(chromeMock.state.detachCalls, 0);
  releaseAttach();
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(chromeMock.state.detachCalls, 1);
});

test("a hung CDP command times out and always detaches", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "Page.enable") return pending();
    return chromeMock.state.defaultCommand(command);
  });
  const { controller } = makeController(chromeMock, { timeouts: { command: 6 } });
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "cdp_rejected");
  assert.equal(result.stage, "chooser_enable");
  assert.equal(chromeMock.state.detachCalls, 1);
  assert.equal(chromeMock.state.debuggerDetach.listeners.size, 0);
});

test("missing marked control across application frames stops before any chooser click", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "DOM.performSearch") return { searchId: "empty-search", resultCount: 0 };
    return chromeMock.state.defaultCommand(command);
  });
  const { controller } = makeController(chromeMock);
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "input_not_found");
  assert.equal(result.stage, "target_query");
  assert.equal(chromeMock.state.commands.some(({ method }) => method === "Input.dispatchMouseEvent"), false);
  assert.equal(chromeMock.state.commands.some(({ method }) => method === "DOM.discardSearchResults"), true);
  assert.equal(chromeMock.state.detachCalls, 1);
});

test("chooser timeout is ambiguous, disables interception, detaches, and cannot be reset", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setEmitChooser(false);
  const { controller } = makeController(chromeMock, { timeouts: { chooser: 6 } });
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "input_not_found");
  assert.equal(result.stage, "chooser_wait");
  assert.equal(result.cdpStatus, "ambiguous");
  assert.equal(chromeMock.state.debuggerEvent.listeners.size, 0);
  assert.equal(chromeMock.state.detachCalls, 1);
  const clear = await controller.clearLatestStatus({ tabId: 17 });
  assert.equal(clear.ok, false);
  assert.equal(clear.failure?.reason, "duplicate_prevented");
});

test("ambiguous DOM.setFileInputFiles timeout is never followed by another assignment", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "DOM.setFileInputFiles") return pending();
    return chromeMock.state.defaultCommand(command);
  });
  const first = makeController(chromeMock, { timeouts: { command: 6 } }).controller;
  const firstResult = await first.upload(validMessage, validSender);
  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.stage, "file_assignment");
  assert.equal(firstResult.cdpStatus, "ambiguous");

  const restarted = makeController(chromeMock).controller;
  const secondResult = await restarted.upload({ ...validMessage, attemptId: "rt_attempt_second_123456" }, validSender);
  assert.equal(secondResult.failure?.reason, "duplicate_prevented");
  assert.equal(chromeMock.state.commands.filter(({ method }) => method === "DOM.setFileInputFiles").length, 1);
  assert.equal(chromeMock.state.downloads.length, 1);
});

test("unexpected debugger detach becomes a structured manual handoff with no retry", async () => {
  const chromeMock = createChromeMock();
  chromeMock.state.setCommandImpl(async (command) => {
    const response = await chromeMock.state.defaultCommand(command);
    if (command.method === "Input.dispatchMouseEvent" && command.params.type === "mousePressed") {
      chromeMock.state.debuggerDetach.emit({ tabId: 17 }, "target_closed");
    }
    return response;
  });
  const { controller } = makeController(chromeMock);
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, false);
  assert.equal(result.failure?.reason, "debugger_unavailable");
  assert.equal(result.stage, "debugger_detached");
  assert.equal(result.cdpStatus, "ambiguous");
  assert.equal(chromeMock.state.debuggerEvent.listeners.size, 0);
  assert.equal(chromeMock.state.debuggerDetach.listeners.size, 0);
});

test("hung interception and detach cleanup are bounded and reported without changing validated success", async () => {
  const chromeMock = createChromeMock();
  let enabled = false;
  chromeMock.state.setCommandImpl(async (command) => {
    if (command.method === "Page.setInterceptFileChooserDialog" && command.params.enabled === true) enabled = true;
    if (command.method === "Page.setInterceptFileChooserDialog" && command.params.enabled === false && enabled) return pending();
    return chromeMock.state.defaultCommand(command);
  });
  chromeMock.state.setDetachImpl(() => pending());
  const { controller } = makeController(chromeMock, { timeouts: { cleanup: 4 } });
  const result = await controller.upload(validMessage, validSender);

  assert.equal(result.ok, true);
  assert.equal(result.cdpStatus, "validated");
  assert.equal(result.cleanupWarnings?.length, 2);
  assert.match(result.cleanupWarnings?.join(" ") || "", /interception cleanup failed/);
  assert.match(result.cleanupWarnings?.join(" ") || "", /detach failed/);
});
