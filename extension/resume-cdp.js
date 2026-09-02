// Background-only controller for the extension's single chooser-driven CDP upload.
(function initResumeCdpController(global) {
  const TARGET_ATTRIBUTE = "data-rt-cdp-upload-token";
  const PROTOCOL_VERSION = "1.3";
  const CONTROLLER_VERSION = "3.6.1";
  const ATTEMPT_PREFIX = "resumeUploadAttempt_v35_";
  const LATEST_PREFIX = "resumeUploadLatest_v35_";
  const DEFAULT_TIMEOUTS = Object.freeze({
    fetch: 10_000, document: 20_000, download: 30_000, attach: 5_000,
    command: 5_000, chooser: 8_000, validation: 15_000, cleanup: 2_000,
    storage: 2_000, total: 75_000,
  });

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error || "Unknown error");
  }

  function controllerError(reason, message, stage, details = {}) {
    const error = new Error(message);
    error.reason = reason;
    error.stage = stage;
    Object.assign(error, details);
    return error;
  }

  function failure(reason, message, details = {}) {
    const stage = details.stage || "unknown";
    return {
      ok: false,
      filename: details.filename || null,
      method: "chooser",
      cdpStatus: details.cdpStatus || "failed",
      stage,
      attemptId: details.attemptId || null,
      failure: { reason, message, stage },
      ...(details.cleanupWarnings?.length ? { cleanupWarnings: details.cleanupWarnings } : {}),
    };
  }

  function profileResumeFilename(profile, format = "docx") {
    const name = [profile?.first_name, profile?.last_name]
      .map((part) => String(part || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, ""))
      .join("")
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 100);
    return `${name ? `${name}-Resume` : "Resume"}.${format === "pdf" ? "pdf" : "docx"}`;
  }

  function linkedInJobIdFromSender(sender) {
    try {
      const url = new URL(String(sender?.tab?.url || ""));
      const pathId = url.pathname.match(/\/jobs\/view\/(\d+)/i)?.[1];
      const queryId = url.searchParams.get("currentJobId");
      return pathId || (/^\d+$/.test(queryId || "") ? queryId : null) || "unknown";
    } catch {
      return "unknown";
    }
  }

  function validateRequest(message, sender) {
    const port = Number(message?.port);
    const jobId = Number(message?.jobId);
    const format = message?.format === "pdf" ? "pdf" : message?.format === "docx" ? "docx" : null;
    const targetToken = String(message?.targetToken || "");
    const tabId = Number(sender?.tab?.id || message?.tabId);
    const frameId = Number.isInteger(sender?.frameId) && sender.frameId >= 0 ? sender.frameId : 0;
    const suppliedPostingId = String(message?.linkedInJobId || "");
    const linkedInJobId = /^\d{1,40}$/.test(suppliedPostingId) ? suppliedPostingId : linkedInJobIdFromSender(sender);
    const suppliedAttemptId = String(message?.attemptId || "");
    const attemptId = /^[a-zA-Z0-9_-]{12,160}$/.test(suppliedAttemptId)
      ? suppliedAttemptId
      : `rt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2).padEnd(20, "0")}`;

    if (!Number.isInteger(tabId) || tabId <= 0) throw controllerError("debugger_unavailable", "The upload request is not associated with a browser tab.", "request_validation");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw controllerError("download_failed", "The local app port is invalid.", "request_validation");
    if (!Number.isInteger(jobId) || jobId <= 0) throw controllerError("download_failed", "A tracked job is required for the résumé upload.", "request_validation");
    if (!format) throw controllerError("download_failed", "The résumé format must be DOCX or PDF.", "request_validation");
    if (targetToken && !/^[a-zA-Z0-9_-]{12,160}$/.test(targetToken)) throw controllerError("input_not_found", "The marked résumé Upload control token is invalid.", "request_validation");
    return { port, jobId, format, targetToken: targetToken || null, accessibilityTarget: !targetToken, tabId, frameId, linkedInJobId, attemptId };
  }

  function attemptKey(request) {
    return `${ATTEMPT_PREFIX}${request.tabId}_${request.linkedInJobId}_${request.jobId}_${request.format}`;
  }

  function latestKey(tabId) {
    return `${LATEST_PREFIX}${tabId}`;
  }

  function withTimeout(promise, timeoutMs, makeError, timers) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(makeError());
      }, Math.max(1, timeoutMs));
      Promise.resolve(promise).then((value) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        reject(error);
      });
    });
  }

  function waitForDownload(chromeApi, downloadId, timeoutMs, timers) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, item) => {
        if (settled) return;
        settled = true;
        timers.clearTimeout(timer);
        chromeApi.downloads.onChanged.removeListener(onChanged);
        if (error) reject(error);
        else resolve(item);
      };
      const inspect = async () => {
        try {
          const items = await chromeApi.downloads.search({ id: downloadId });
          if (settled) return;
          const item = items?.find((candidate) => candidate.id === downloadId);
          if (!item) return;
          if (item.state === "complete" && item.filename) finish(null, item);
          else if (item.state === "interrupted") {
            finish(controllerError("download_failed", `The generated résumé download was interrupted${item.error ? ` (${item.error})` : ""}.`, "download_wait"));
          }
        } catch (error) {
          finish(controllerError("download_failed", `Could not resolve the generated résumé path: ${errorMessage(error)}`, "download_wait"));
        }
      };
      const onChanged = (delta) => {
        if (delta.id === downloadId && (delta.state || delta.error || delta.filename)) void inspect();
      };
      const timer = timers.setTimeout(() => {
        finish(controllerError("download_failed", "Timed out waiting for Chrome to finish the generated résumé download.", "download_wait"));
      }, Math.max(1, timeoutMs));
      chromeApi.downloads.onChanged.addListener(onChanged);
      void inspect();
    });
  }

  function waitForChooser(chromeApi, tabId, timeoutMs, timers, detachedPromise) {
    let listener = null;
    let timer = null;
    let settled = false;
    let rejectWait = null;
    const cleanup = () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      if (listener) chromeApi.debugger.onEvent.removeListener(listener);
      listener = null;
    };
    const eventPromise = new Promise((resolve, reject) => {
      rejectWait = reject;
      listener = (source, method, params) => {
        if (settled || source?.tabId !== tabId || method !== "Page.fileChooserOpened") return;
        settled = true;
        cleanup();
        resolve({ source, params });
      };
      chromeApi.debugger.onEvent.addListener(listener);
      timer = timers.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(controllerError("input_not_found", "LinkedIn did not open a file chooser from the marked visible Upload control.", "chooser_wait", { ambiguous: true }));
      }, Math.max(1, timeoutMs));
    });
    const promise = Promise.race([eventPromise, detachedPromise]);
    promise.catch(() => {});
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        cleanup();
        rejectWait?.(controllerError("input_not_found", "The file chooser wait was cancelled.", "chooser_wait"));
        eventPromise.catch(() => {});
      },
    };
  }

  function boxCenter(boxModel) {
    const quad = boxModel?.border || boxModel?.content;
    if (!Array.isArray(quad) || quad.length < 8 || quad.some((value) => !Number.isFinite(Number(value)))) {
      throw controllerError("input_not_found", "CDP could not determine the marked Upload control's visible bounds.", "target_bounds");
    }
    return {
      x: (Number(quad[0]) + Number(quad[2]) + Number(quad[4]) + Number(quad[6])) / 4,
      y: (Number(quad[1]) + Number(quad[3]) + Number(quad[5]) + Number(quad[7])) / 4,
    };
  }

  function accessibilityValue(value) {
    return String(value?.value ?? value ?? "").replace(/\s+/g, " ").trim();
  }

  function accessibilityUploadTarget(nodes) {
    return (nodes || []).find((node) => {
      if (node?.ignored || !Number.isInteger(node?.backendDOMNodeId) || node.backendDOMNodeId <= 0) return false;
      const role = accessibilityValue(node.role).toLowerCase();
      const name = accessibilityValue(node.name);
      return role === "button" && /\bupload\s+(?:resume|cv)\b/i.test(name);
    }) || null;
  }

  function accessibilityResumeState(nodes, filename) {
    const wanted = String(filename || "").toLowerCase();
    const visibleNodes = (nodes || []).filter((node) => !node?.ignored);
    const names = visibleNodes.map((node) => accessibilityValue(node.name)).filter(Boolean);
    const filenamePresent = Boolean(wanted) && names.some((name) => name.toLowerCase().includes(wanted));
    const selected = Boolean(wanted) && visibleNodes.some((node) => {
      const name = accessibilityValue(node.name).toLowerCase();
      if (!name.includes(wanted)) return false;
      if (/\bdeselect\s+resume\b/i.test(name)) return true;
      return (node.properties || []).some((property) =>
        ["checked", "selected"].includes(String(property?.name || "")) &&
        ["true", "1"].includes(accessibilityValue(property?.value).toLowerCase())
      );
    });
    const requiredErrorVisible = names.some((name) =>
      /(?:resume|cv)\s+(?:is\s+)?required|(?:required|missing).{0,80}(?:resume|cv)/i.test(name)
    );
    return { accepted: filenamePresent && selected && !requiredErrorVisible, filenamePresent, selected, requiredErrorVisible };
  }

  function accessibilityResumeSelectTarget(nodes, filename) {
    const wanted = String(filename || "").toLowerCase();
    if (!wanted) return null;
    return (nodes || []).find((node) => {
      if (node?.ignored || !Number.isInteger(node?.backendDOMNodeId) || node.backendDOMNodeId <= 0) return false;
      const name = accessibilityValue(node.name).toLowerCase();
      return name.includes(wanted) && /\bselect\s+resume\b/i.test(name) && !/\bdeselect\s+resume\b/i.test(name);
    }) || null;
  }

  function createResumeCdpController({
    chromeApi = global.chrome,
    fetchImpl = global.fetch,
    toDataUrl,
    validateAcceptance = null,
    onStage = null,
    timeouts: timeoutOverrides = {},
    downloadTimeoutMs,
    chooserTimeoutMs,
    timers = global,
  } = {}) {
    if (!chromeApi || typeof fetchImpl !== "function" || typeof toDataUrl !== "function") {
      throw new Error("Resume CDP controller dependencies are unavailable");
    }
    const timeouts = {
      ...DEFAULT_TIMEOUTS,
      ...timeoutOverrides,
      ...(Number.isFinite(downloadTimeoutMs) ? { download: downloadTimeoutMs } : {}),
      ...(Number.isFinite(chooserTimeoutMs) ? { chooser: chooserTimeoutMs } : {}),
    };
    const storage = chromeApi.storage?.session;
    const activeAttempts = new Map();
    const boundedMs = (limit, deadline) => Math.max(1, Math.min(Number(limit) || 1, deadline - Date.now()));
    const storageError = (stage) => controllerError("cdp_rejected", "Chrome session storage did not respond, so duplicate-safe upload cannot continue.", stage);

    async function storageGet(key, deadline = Date.now() + timeouts.storage) {
      if (!storage?.get) throw storageError("state_read");
      return withTimeout(storage.get(key), boundedMs(timeouts.storage, deadline), () => storageError("state_read"), timers);
    }

    async function storageSet(values, deadline = Date.now() + timeouts.storage) {
      if (!storage?.set) throw storageError("state_write");
      return withTimeout(storage.set(values), boundedMs(timeouts.storage, deadline), () => storageError("state_write"), timers);
    }

    async function storageRemove(keys, deadline = Date.now() + timeouts.storage) {
      if (!storage?.remove) throw storageError("state_clear");
      return withTimeout(storage.remove(keys), boundedMs(timeouts.storage, deadline), () => storageError("state_clear"), timers);
    }

    async function getLatestStatus({ tabId }) {
      if (!Number.isInteger(tabId) || tabId <= 0) return null;
      const pointer = await storageGet(latestKey(tabId));
      const key = pointer?.[latestKey(tabId)];
      if (!key) return null;
      const stored = await storageGet(key);
      return stored?.[key] || null;
    }

    async function clearLatestStatus({ tabId }) {
      const status = await getLatestStatus({ tabId });
      if (!status) return { ok: true, cleared: false };
      if (status.fileSet || status.ambiguous || status.stage === "validated") {
        return {
          ok: false,
          cleared: false,
          failure: {
            reason: "duplicate_prevented",
            message: "This upload may already have selected a file. It cannot be reset safely; review LinkedIn manually.",
          },
          status,
        };
      }
      await storageRemove([status.storageKey, latestKey(tabId)]);
      return { ok: true, cleared: true };
    }

    async function uploadInternal(request) {
      const deadline = Date.now() + timeouts.total;
      const storageKey = attemptKey(request);
      let status = {
        version: CONTROLLER_VERSION, storageKey, attemptId: request.attemptId,
        tabId: request.tabId, frameId: request.frameId, linkedInJobId: request.linkedInJobId,
        jobId: request.jobId, format: request.format, method: "chooser",
        targetMode: request.accessibilityTarget ? "accessibility" : "marked_dom",
        stage: "preparing", filename: null, downloadId: null,
        cdpStatus: "not_started", fileSet: false, ambiguous: false,
        terminal: false, failure: null, startedAt: Date.now(), updatedAt: Date.now(), history: [],
      };

      async function persist(stage, patch = {}) {
        const entry = { stage, at: Date.now() };
        status = {
          ...status, ...patch, stage, updatedAt: entry.at,
          history: [...(status.history || []), entry].slice(-30),
        };
        await storageSet({ [storageKey]: status, [latestKey(request.tabId)]: storageKey }, deadline);
        if (typeof onStage === "function") {
          try { Promise.resolve(onStage({ ...status })).catch(() => {}); } catch { /* telemetry is best effort */ }
        }
        return status;
      }

      async function timedFetch(url, init, limit, stage) {
        const abortController = typeof global.AbortController === "function" ? new global.AbortController() : null;
        try {
          return await withTimeout(
            fetchImpl(url, abortController ? { ...(init || {}), signal: abortController.signal } : init),
            boundedMs(limit, deadline),
            () => {
              abortController?.abort();
              return controllerError("download_failed", `Timed out during ${stage.replaceAll("_", " ")}.`, stage);
            },
            timers,
          );
        } catch (error) {
          if (error?.reason) throw error;
          throw controllerError("download_failed", `${stage.replaceAll("_", " ")} failed: ${errorMessage(error)}`, stage);
        }
      }

      async function generateAndDownload() {
        let profile = null;
        await persist("fetching_profile");
        try {
          const response = await timedFetch(`http://localhost:${request.port}/api/profile`, undefined, timeouts.fetch, "profile_fetch");
          if (response.ok) profile = await response.json();
        } catch { /* use the safe fallback filename */ }
        const filename = profileResumeFilename(profile, request.format);

        await persist("fetching_tailored", { filename });
        const tailoredResponse = await timedFetch(`http://localhost:${request.port}/api/resume/tailored/${request.jobId}`, undefined, timeouts.fetch, "tailored_fetch");
        if (!tailoredResponse.ok) throw controllerError("download_failed", `Could not load the job-specific résumé (HTTP ${tailoredResponse.status}).`, "tailored_fetch");
        const tailored = await withTimeout(
          tailoredResponse.json(), boundedMs(timeouts.fetch, deadline),
          () => controllerError("download_failed", "Timed out reading the job-specific résumé.", "tailored_fetch"), timers,
        );
        if (!tailored?.exists || !tailored.content) throw controllerError("download_failed", "A current job-specific tailored résumé is required for automated upload.", "tailored_fetch");

        await persist("generating_document", { filename });
        const documentResponse = await timedFetch(`http://localhost:${request.port}/api/resume/${request.format}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: tailored.content, filename }),
        }, timeouts.document, "document_generation");
        if (!documentResponse.ok) {
          const body = await documentResponse.json().catch(() => ({}));
          throw controllerError("download_failed", body.error || `${request.format.toUpperCase()} generation failed (HTTP ${documentResponse.status}).`, "document_generation");
        }
        const blob = await withTimeout(
          documentResponse.blob(), boundedMs(timeouts.document, deadline),
          () => controllerError("download_failed", `Timed out reading the generated ${request.format.toUpperCase()} file.`, "document_generation"), timers,
        );
        if (!blob?.size) throw controllerError("download_failed", `${request.format.toUpperCase()} generation returned an empty file.`, "document_generation");
        const dataUrl = await withTimeout(
          toDataUrl(blob), boundedMs(timeouts.document, deadline),
          () => controllerError("download_failed", "Timed out preparing the generated résumé download.", "download_start"), timers,
        );
        const relativePath = `ResumeTracker/Uploads/${request.jobId}/${filename}`;
        await persist("starting_download", { filename });
        const downloadId = await withTimeout(
          chromeApi.downloads.download({ url: dataUrl, filename: relativePath, conflictAction: "overwrite", saveAs: false }),
          boundedMs(timeouts.command, deadline),
          () => controllerError("download_failed", "Chrome did not respond when starting the generated résumé download.", "download_start"), timers,
        );
        if (!Number.isInteger(downloadId)) throw controllerError("download_failed", "Chrome did not start the generated résumé download.", "download_start");
        await persist("waiting_for_download", { downloadId });
        const item = await waitForDownload(chromeApi, downloadId, boundedMs(timeouts.download, deadline), timers);
        const resolvedFilename = String(item.filename).split(/[\\/]/).pop() || filename;
        await persist("downloaded", { filename: resolvedFilename, downloadId });
        return { filename: resolvedFilename, absolutePath: item.filename };
      }

      const debuggee = { tabId: request.tabId };
      let generated = null;
      let attached = false;
      let interceptionEnabled = false;
      let accessibilityEnabled = false;
      let accessibilityTarget = null;
      let chooser = null;
      let detachListener = null;
      let detachReject = null;
      const cleanupWarnings = [];
      const detachedPromise = new Promise((_, reject) => { detachReject = reject; });
      detachedPromise.catch(() => {});

      async function attach() {
        let expired = false;
        const attachPromise = Promise.resolve().then(() => chromeApi.debugger.attach(debuggee, PROTOCOL_VERSION));
        attachPromise.then(() => {
          if (!expired) return;
          withTimeout(
            chromeApi.debugger.detach(debuggee), timeouts.cleanup,
            () => controllerError("debugger_unavailable", "Late debugger attach cleanup timed out.", "attach_cleanup"), timers,
          ).catch(() => {});
        }).catch(() => {});
        try {
          await withTimeout(attachPromise, boundedMs(timeouts.attach, deadline), () => {
            expired = true;
            return controllerError("debugger_unavailable", "Timed out while attaching Chrome's debugger to the LinkedIn tab.", "debugger_attach");
          }, timers);
          attached = true;
        } catch (error) {
          if (error?.reason) throw error;
          throw controllerError("debugger_unavailable", `Chrome could not attach its debugger to this tab: ${errorMessage(error)}`, "debugger_attach");
        }
      }

      async function command(target, method, params, stage) {
        try {
          return await withTimeout(
            Promise.race([chromeApi.debugger.sendCommand(target, method, params || {}), detachedPromise]),
            boundedMs(timeouts.command, deadline),
            () => controllerError("cdp_rejected", `Chrome did not respond to ${method}.`, stage, { ambiguous: status.ambiguous }), timers,
          );
        } catch (error) {
          if (error?.reason) throw error;
          throw controllerError("cdp_rejected", `${method} failed: ${errorMessage(error)}`, stage, { ambiguous: status.ambiguous });
        }
      }

      async function resolveMarkedTargetNode() {
        await command(debuggee, "DOM.getDocument", { depth: 0, pierce: true }, "target_document");
        const selector = `[${TARGET_ATTRIBUTE}="${request.targetToken}"]`;
        let searchId = null;
        try {
          const search = await command(debuggee, "DOM.performSearch", {
            query: selector,
            includeUserAgentShadowDOM: true,
          }, "target_query");
          searchId = search?.searchId || null;
          if (!searchId || !search?.resultCount) return null;
          const results = await command(debuggee, "DOM.getSearchResults", {
            searchId,
            fromIndex: 0,
            toIndex: Math.min(Number(search.resultCount), 20),
          }, "target_query");
          return results?.nodeIds?.find((nodeId) => Number.isInteger(nodeId) && nodeId > 0) || null;
        } finally {
          if (searchId) {
            withTimeout(
              chromeApi.debugger.sendCommand(debuggee, "DOM.discardSearchResults", { searchId }),
              timeouts.cleanup,
              () => controllerError("cdp_rejected", "DOM search cleanup timed out.", "cleanup"),
              timers,
            ).catch(() => {});
          }
        }
      }

      async function resolveAccessibilityTarget() {
        await command(debuggee, "Accessibility.enable", {}, "accessibility_enable");
        accessibilityEnabled = true;
        const tree = await command(debuggee, "Accessibility.getFullAXTree", {}, "accessibility_target");
        return accessibilityUploadTarget(tree?.nodes);
      }

      async function clickCdpNode(params, stage) {
        const box = await command(debuggee, "DOM.getBoxModel", params, `${stage}_bounds`);
        const point = boxCenter(box?.model || box);
        await command(debuggee, "Input.dispatchMouseEvent", {
          type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
        }, stage);
        await command(debuggee, "Input.dispatchMouseEvent", {
          type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
        }, stage);
        return point;
      }

      async function waitForAccessibilityAcceptance(filename) {
        const validationDeadline = Math.min(deadline, Date.now() + timeouts.validation);
        let lastState = { accepted: false, filenamePresent: false, selected: false, requiredErrorVisible: false };
        let selectionAttempted = false;
        while (Date.now() < validationDeadline) {
          const tree = await command(debuggee, "Accessibility.getFullAXTree", {}, "validation");
          lastState = accessibilityResumeState(tree?.nodes, filename);
          if (lastState.accepted) return lastState;
          if (lastState.filenamePresent && !lastState.selected && !selectionAttempted) {
            const selectTarget = accessibilityResumeSelectTarget(tree?.nodes, filename);
            if (selectTarget) {
              selectionAttempted = true;
              await persist("selecting_resume", { ambiguous: true, cdpStatus: "file_set" });
              await clickCdpNode({ backendNodeId: selectTarget.backendDOMNodeId }, "resume_selection");
              continue;
            }
          }
          await new Promise((resolve) => timers.setTimeout(resolve, 250));
        }
        return lastState;
      }

      async function cleanup() {
        chooser?.cancel();
        chooser = null;
        if (detachListener) chromeApi.debugger.onDetach?.removeListener(detachListener);
        detachListener = null;
        if (attached && interceptionEnabled) {
          try {
            await withTimeout(
              chromeApi.debugger.sendCommand(debuggee, "Page.setInterceptFileChooserDialog", { enabled: false }),
              timeouts.cleanup, () => controllerError("cdp_rejected", "Chooser interception cleanup timed out.", "cleanup"), timers,
            );
          } catch (error) { cleanupWarnings.push(`chooser interception cleanup failed: ${errorMessage(error)}`); }
        }
        interceptionEnabled = false;
        if (attached && accessibilityEnabled) {
          try {
            await withTimeout(
              chromeApi.debugger.sendCommand(debuggee, "Accessibility.disable", {}),
              timeouts.cleanup, () => controllerError("cdp_rejected", "Accessibility cleanup timed out.", "cleanup"), timers,
            );
          } catch (error) { cleanupWarnings.push(`accessibility cleanup failed: ${errorMessage(error)}`); }
        }
        accessibilityEnabled = false;
        if (attached) {
          try {
            await withTimeout(
              chromeApi.debugger.detach(debuggee), timeouts.cleanup,
              () => controllerError("debugger_unavailable", "Debugger detach cleanup timed out.", "cleanup"), timers,
            );
          } catch (error) { cleanupWarnings.push(`debugger detach failed: ${errorMessage(error)}`); }
        }
        attached = false;
      }

      let operationError = null;
      try {
        if (request.accessibilityTarget) {
          await attach();
          accessibilityTarget = await resolveAccessibilityTarget();
          if (!accessibilityTarget) {
            throw controllerError(
              "input_not_found",
              "The current LinkedIn step does not expose a visible résumé Upload control.",
              "accessibility_target",
              { probeMiss: true },
            );
          }
        }

        await persist("preparing", { cdpStatus: attached ? "attached" : "not_started" });
        generated = await generateAndDownload();
        if (!attached) {
          await persist("attaching_debugger", { filename: generated.filename, cdpStatus: "not_attached" });
          await attach();
        }
        await persist("debugger_attached", { cdpStatus: "attached" });
        detachListener = (source, reason) => {
          if (source?.tabId !== request.tabId) return;
          detachReject(controllerError("debugger_unavailable", `Chrome detached the debugger before the upload completed${reason ? ` (${reason})` : ""}.`, "debugger_detached", { ambiguous: status.ambiguous }));
        };
        chromeApi.debugger.onDetach?.addListener(detachListener);

        await persist("enabling_chooser");
        await command(debuggee, "Page.enable", { enableFileChooserOpenedEvent: true }, "chooser_enable");
        await command(debuggee, "Page.setInterceptFileChooserDialog", { enabled: true }, "chooser_interception");
        interceptionEnabled = true;

        await persist("resolving_target");
        const targetParams = request.accessibilityTarget
          ? { backendNodeId: accessibilityTarget.backendDOMNodeId }
          : { nodeId: await resolveMarkedTargetNode() };
        if (!targetParams.nodeId && !targetParams.backendNodeId) throw controllerError("input_not_found", "The marked visible résumé Upload control was not found across LinkedIn's application frames.", "target_query");
        chooser = waitForChooser(chromeApi, request.tabId, boundedMs(timeouts.chooser, deadline), timers, detachedPromise);
        await persist("clicking_upload", { ambiguous: true, cdpStatus: "ambiguous" });
        await clickCdpNode(targetParams, "upload_click");
        const opened = await chooser.promise;
        chooser = null;
        if (!opened.params?.backendNodeId) throw controllerError("input_not_found", "The intercepted chooser did not identify LinkedIn's file input.", "chooser_opened", { ambiguous: true });

        await persist("file_set_pending", { ambiguous: true, cdpStatus: "ambiguous" });
        await command(opened.source, "DOM.setFileInputFiles", {
          backendNodeId: opened.params.backendNodeId, files: [generated.absolutePath],
        }, "file_assignment");
        await persist("file_set", { fileSet: true, ambiguous: false, cdpStatus: "file_set" });

        if (request.accessibilityTarget) {
          await persist("validating", { cdpStatus: "file_set" });
          const validation = await waitForAccessibilityAcceptance(generated.filename);
          if (!validation.accepted) {
            throw controllerError(
              "validation_unconfirmed",
              validation.requiredErrorVisible
                ? "Chrome set the generated résumé, but LinkedIn still shows that a résumé is required. Review this application manually; the file will not be uploaded again."
                : "Chrome set the generated résumé, but LinkedIn did not confirm the generated filename as the selected résumé. Review this application manually; the file will not be uploaded again.",
              "validation", { ambiguous: true },
            );
          }
        }
      } catch (error) {
        operationError = error?.reason ? error : controllerError("cdp_rejected", errorMessage(error), error?.stage || status.stage, { ambiguous: status.ambiguous });
      } finally {
        await cleanup();
      }

      if (operationError?.probeMiss && !status.history.length) {
        return failure(operationError.reason, errorMessage(operationError), {
          filename: null, cdpStatus: "not_started", stage: operationError.stage,
          attemptId: request.attemptId, cleanupWarnings,
        });
      }

      if (!request.accessibilityTarget && !operationError && status.fileSet && typeof validateAcceptance !== "function") {
        operationError = controllerError(
          "validation_unconfirmed",
          "Chrome set the generated résumé, but no LinkedIn acceptance validator was available. Review this application manually; the file will not be uploaded again.",
          "validation",
          { ambiguous: true },
        );
      }
      if (!request.accessibilityTarget && !operationError && status.fileSet && typeof validateAcceptance === "function") {
        try {
          await persist("validating", { cdpStatus: "file_set" });
          const validation = await withTimeout(
            validateAcceptance({ tabId: request.tabId, frameId: request.frameId, targetToken: request.targetToken, filename: generated.filename, method: "chooser" }),
            boundedMs(timeouts.validation, deadline),
            () => controllerError("validation_unconfirmed", "Timed out waiting for LinkedIn to confirm the selected résumé. Review this application manually; the file will not be uploaded again.", "validation", { ambiguous: true }), timers,
          );
          if (!validation?.accepted) {
            throw controllerError(
              "validation_unconfirmed",
              validation?.requiredErrorVisible
                ? "Chrome set the generated résumé, but LinkedIn still shows that a résumé is required. Review this application manually; the file will not be uploaded again."
                : "Chrome set the generated résumé, but LinkedIn did not confirm the generated filename as selected. Review this application manually; the file will not be uploaded again.",
              "validation", { ambiguous: true },
            );
          }
        } catch (error) {
          operationError = error?.reason ? error : controllerError(
            "validation_unconfirmed",
            `Chrome set the generated résumé, but LinkedIn acceptance could not be confirmed (${errorMessage(error)}). Review this application manually; the file will not be uploaded again.`,
            "validation", { ambiguous: true },
          );
        }
      }

      if (operationError) {
        const failedStage = operationError.stage || status.stage;
        const ambiguous = Boolean(status.fileSet || status.ambiguous || operationError.ambiguous);
        const cdpStatus = status.fileSet ? "file_set" : ambiguous ? "ambiguous" : status.cdpStatus;
        const failureDetails = { reason: operationError.reason || "cdp_rejected", message: errorMessage(operationError), stage: failedStage };
        try {
          await persist("needs_manual", {
            ambiguous, terminal: true, cdpStatus, failure: failureDetails,
            failedStage, cleanupWarnings,
          });
        } catch { /* retain the primary failure */ }
        return failure(failureDetails.reason, failureDetails.message, {
          filename: status.filename, cdpStatus, stage: failedStage,
          attemptId: request.attemptId, cleanupWarnings,
        });
      }

      const success = {
        ok: true, filename: generated.filename, method: "chooser",
        cdpStatus: "validated", stage: "validated", attemptId: request.attemptId,
        failure: null, ...(cleanupWarnings.length ? { cleanupWarnings } : {}),
      };
      try {
        await persist("validated", { terminal: true, cdpStatus: "validated", ambiguous: false, failure: null, cleanupWarnings });
      } catch (error) {
        return failure("validation_unconfirmed", `LinkedIn accepted the résumé, but the duplicate-safety record could not be saved (${errorMessage(error)}). Do not upload again; review the application manually.`, {
          filename: generated.filename, cdpStatus: "file_set", stage: "state_write",
          attemptId: request.attemptId, cleanupWarnings,
        });
      }
      return success;
    }

    async function upload(message, sender) {
      let request;
      try { request = validateRequest(message, sender); }
      catch (error) {
        return failure(error.reason || "download_failed", errorMessage(error), { stage: error.stage || "request_validation" });
      }
      const key = attemptKey(request);
      if (activeAttempts.has(key)) return activeAttempts.get(key);
      const attempt = (async () => {
        let existing;
        try {
          const stored = await storageGet(key);
          existing = stored?.[key] || null;
        } catch (error) {
          return failure("cdp_rejected", errorMessage(error), {
            cdpStatus: "not_started", stage: error.stage || "state_read", attemptId: request.attemptId,
          });
        }
        if (existing?.stage === "validated") {
          return {
            ok: true, filename: existing.filename, method: "chooser", cdpStatus: "validated",
            stage: "validated", attemptId: existing.attemptId, failure: null, duplicatePrevented: true,
          };
        }
        if (existing) {
          const original = existing.failure?.message ? ` Previous result: ${existing.failure.message}` : "";
          return failure("duplicate_prevented", `An upload attempt already exists at stage “${existing.failedStage || existing.stage}”. It will not be run again.${original}`, {
            filename: existing.filename, cdpStatus: existing.cdpStatus || "ambiguous",
            stage: existing.failedStage || existing.stage, attemptId: existing.attemptId,
            cleanupWarnings: existing.cleanupWarnings,
          });
        }
        return uploadInternal(request);
      })();
      activeAttempts.set(key, attempt);
      try { return await attempt; }
      finally { activeAttempts.delete(key); }
    }

    return { upload, getLatestStatus, clearLatestStatus };
  }

  global.ResumeTrackerCdp = {
    TARGET_ATTRIBUTE, CONTROLLER_VERSION, createResumeCdpController,
    profileResumeFilename, validateRequest,
  };
})(globalThis);
