// Background service worker — handles DOCX downloads and cross-script messaging

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "DOWNLOAD_RESUME") {
    handleResumeDownload(msg, sender).then(sendResponse).catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });
    return true; // keep channel open for async response
  }

  if (msg.type === "GET_PROFILE") {
    const port = msg.port || 3000;
    fetch(`http://localhost:${port}/api/profile`)
      .then((r) => r.json())
      .then((profile) => sendResponse({ ok: true, profile }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "FILL_STATUS") {
    // Relay fill-status from content script → popup (if open)
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});

async function handleResumeDownload({ port, jobId, filename }) {
  port = port || 3000;

  // Fetch the resume markdown content
  let resumeContent = null;
  let resolvedFilename = filename || "resume.docx";

  if (jobId) {
    // Try to get tailored resume for this job
    const tailoredRes = await fetch(`http://localhost:${port}/api/resume/tailored/${jobId}`);
    if (tailoredRes.ok) {
      const data = await tailoredRes.json();
      if (data.content) {
        resumeContent = data.content;
        resolvedFilename = `resume-job-${jobId}.docx`;
      }
    }
  }

  // Fall back to base resume
  if (!resumeContent) {
    const baseRes = await fetch(`http://localhost:${port}/api/resume`);
    if (baseRes.ok) {
      const data = await baseRes.json();
      resumeContent = data.content;
    }
  }

  if (!resumeContent) {
    throw new Error("No resume found. Please add your base resume in the app first.");
  }

  // Convert markdown → DOCX via the app API
  const docxRes = await fetch(`http://localhost:${port}/api/resume/docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: resumeContent, filename: resolvedFilename }),
  });

  if (!docxRes.ok) {
    const err = await docxRes.json().catch(() => ({}));
    throw new Error(err.error || `DOCX generation failed: HTTP ${docxRes.status}`);
  }

  const blob = await docxRes.blob();
  const dataUrl = await blobToDataUrl(blob);

  await chrome.downloads.download({
    url: dataUrl,
    filename: resolvedFilename,
    saveAs: false,
  });

  return { ok: true, filename: resolvedFilename };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
