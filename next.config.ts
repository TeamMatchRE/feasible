import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the tracing root so a stray ~/package-lock.json doesn't trigger the
  // multi-lockfile workspace-root warning. Every hub app pins this.
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // The zoning-PDF upload is a Server Action carrying the file as base64
    // (~1.33× the raw size). Default cap is 1 MB — raise it so a real town
    // zoning PDF fits. (Anthropic's own PDF request cap is 32 MB.)
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default nextConfig;
