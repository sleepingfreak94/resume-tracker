import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both native modules must stay on the server side and not be bundled
  serverExternalPackages: ["better-sqlite3", "@cursor/sdk"],
};

export default nextConfig;
