import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the tracing root so a stray ~/package-lock.json doesn't trigger the
  // multi-lockfile workspace-root warning. Every hub app pins this.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
