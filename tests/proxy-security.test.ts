import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const originalExtensionId = process.env.RESUME_TRACKER_EXTENSION_ID;

function request(
  path = "/api/profile",
  { host = "localhost:3000", origin, method = "GET" }: { host?: string; origin?: string; method?: string } = {}
) {
  const headers = new Headers({ host });
  if (origin) headers.set("origin", origin);
  return new NextRequest(`http://localhost:3000${path}`, { method, headers });
}

afterEach(() => {
  if (originalExtensionId === undefined) delete process.env.RESUME_TRACKER_EXTENSION_ID;
  else process.env.RESUME_TRACKER_EXTENSION_ID = originalExtensionId;
});

describe("local API proxy security", () => {
  it("accepts same-origin requests on loopback", () => {
    const response = proxy(request("/api/profile", { origin: "http://localhost:3000" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("rejects requests with a non-loopback Host header", async () => {
    const response = proxy(request("/api/profile", { host: "resume.example.com" }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Resume Tracker only accepts local connections" });
  });

  it("rejects ordinary cross-origin websites", async () => {
    const response = proxy(request("/api/profile", { origin: "https://malicious.example" }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Cross-origin request blocked" });
  });

  it("allows installed extension origins when no exact extension ID is configured", () => {
    delete process.env.RESUME_TRACKER_EXTENSION_ID;
    const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const response = proxy(request("/api/profile", { origin }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  });

  it("allows only the configured extension ID", async () => {
    process.env.RESUME_TRACKER_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
    const allowedOrigin = `chrome-extension://${process.env.RESUME_TRACKER_EXTENSION_ID}`;
    const allowed = proxy(request("/api/profile", { origin: allowedOrigin }));
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), allowedOrigin);

    const rejected = proxy(
      request("/api/profile", { origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba" })
    );
    assert.equal(rejected.status, 403);
    assert.deepEqual(await rejected.json(), { error: "Cross-origin request blocked" });
  });

  it("returns CORS headers only for allowed extension preflights", () => {
    process.env.RESUME_TRACKER_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
    const origin = `chrome-extension://${process.env.RESUME_TRACKER_EXTENSION_ID}`;
    const response = proxy(request("/api/profile", { origin, method: "OPTIONS" }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
  });
});
