import { toResumeFilename, type ResumeFilenameProfile } from "@/lib/resume-format";

export async function getLocalResumeFilename(format = "docx"): Promise<string> {
  try {
    const response = await fetch("/api/profile");
    if (response.ok) {
      return toResumeFilename(await response.json() as ResumeFilenameProfile, format);
    }
  } catch {
    // A download should still work when the profile endpoint is temporarily unavailable.
  }
  return toResumeFilename(null, format);
}
