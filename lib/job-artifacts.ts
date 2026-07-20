import fs from "fs";
import path from "path";
import { jobArtifactPath, parsePositiveId } from "./validation";

export function ensureTailoredDirectory(): string {
  const directory = path.join(process.cwd(), "resumes", "tailored");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function removeJobArtifacts(jobId: unknown): void {
  const id = parsePositiveId(jobId);
  if (!id) throw new Error("Invalid job id");
  for (const kind of ["resume", "notes", "cover-letter"] as const) {
    const file = jobArtifactPath(id, kind);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
