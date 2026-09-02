"use client";

import { useEffect, useState } from "react";

type Props = {
  content: string;
  company?: string | null;
  storageKey: string;
  returnTo: string;
  className?: string;
  size?: "sm" | "md";
  onSuccess?: (url: string) => void;
  onError?: (message: string) => void;
};

export default function SaveToDriveButton({
  content,
  company,
  storageKey,
  returnTo,
  className = "",
  size = "sm",
  onSuccess,
  onError,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [driveUrl, setDriveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((d) => setConnected(d.configured && d.connected))
      .catch(() => setConnected(false));

    fetch(`/api/resume/drive?key=${encodeURIComponent(storageKey)}`)
      .then((r) => r.json())
      .then((d) => setDriveUrl(d.url ?? null))
      .catch(() => setDriveUrl(null));
  }, [storageKey]);

  async function saveToDrive() {
    if (!content.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/resume/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, company, storageKey }),
      });
      const data = await res.json();

      if (res.status === 401 && data.needsAuth) {
        setConnected(false);
        const authUrl = new URL("/api/google/auth", window.location.origin);
        authUrl.searchParams.set("returnTo", returnTo);
        window.location.assign(authUrl.toString());
        return;
      }

      if (!res.ok) {
        throw new Error(data.error ?? "Upload failed");
      }

      setConnected(true);
      setDriveUrl(data.url);
      onSuccess?.(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError?.(message);
    } finally {
      setUploading(false);
    }
  }

  const sizeClasses =
    size === "md"
      ? "px-4 py-2 text-sm gap-2"
      : "px-3 py-1.5 text-xs gap-1.5";
  const iconSize = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";

  const saveLabel = uploading
    ? "Uploading..."
    : connected === false
      ? "Connect & Save to Drive"
      : driveUrl
        ? "Update on Drive"
        : "Save to Google Drive";

  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        {driveUrl && (
          <a
            href={driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center ${sizeClasses} bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors`}
          >
            <svg className={iconSize} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Open in Google Drive
          </a>
        )}
        <button
          onClick={saveToDrive}
          disabled={uploading || !content.trim()}
          className={`flex items-center ${sizeClasses} bg-emerald-800 hover:bg-emerald-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors`}
        >
          <svg className={iconSize} viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.71 6.705 5.5 10.5H8.5L12 4.5l3.5 6h3L15.29 6.705A1 1 0 0 0 14.5 6h-5a1 1 0 0 0-.79.705zM5.5 12v7a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7h-2v6H7.5v-6H5.5z" />
          </svg>
          {saveLabel}
        </button>
      </div>
      {error && <p className="text-xs text-red-400 max-w-xs">{error}</p>}
    </div>
  );
}
