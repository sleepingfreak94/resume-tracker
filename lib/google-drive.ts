import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { google } from "googleapis";
import type { Credentials } from "google-auth-library";

const TOKEN_PATH = path.join(process.cwd(), "data", "google-tokens.json");
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function loadTokens(): Credentials | null {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
}

export function saveTokens(tokens: Credentials) {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function clearTokens() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

export function isGoogleConnected(): boolean {
  const tokens = loadTokens();
  return !!(tokens?.refresh_token || tokens?.access_token);
}

/** True when Google rejected the stored refresh/access token (user must re-auth). */
export function isInvalidGrantError(err: unknown): boolean {
  const msg = String(err);
  return /invalid_grant/i.test(msg);
}

export function getAuthUrl(returnTo: string): string {
  const oauth2 = getOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: Buffer.from(returnTo).toString("base64url"),
  });
}

export async function exchangeCodeForTokens(code: string) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  saveTokens(tokens as Credentials);
  return tokens;
}

export function decodeReturnTo(state: string | null): string {
  if (!state) return "/";
  try {
    return Buffer.from(state, "base64url").toString("utf-8") || "/";
  } catch {
    return "/";
  }
}

async function getAuthedClient() {
  const tokens = loadTokens();
  if (!tokens) return null;

  const oauth2 = getOAuth2Client();
  oauth2.setCredentials(tokens);
  oauth2.on("tokens", (newTokens) => {
    saveTokens({ ...tokens, ...newTokens });
  });
  return oauth2;
}

export async function uploadDocx(
  buffer: Buffer,
  filename: string
): Promise<{ fileId: string; url: string }> {
  const auth = await getAuthedClient();
  if (!auth) {
    throw new Error("NOT_CONNECTED");
  }

  const drive = google.drive({ version: "v3", auth });
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Readable.from(buffer),
    },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id;
  const url = res.data.webViewLink;
  if (!fileId || !url) {
    throw new Error("Drive upload succeeded but no file URL returned");
  }

  return { fileId, url };
}
