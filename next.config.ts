import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/heavy deps stay as plain node_modules instead of being bundled.
  serverExternalPackages: ["@react-pdf/renderer", "@libsql/client", "unpdf"],
  // The resume PDF is read from disk at runtime, so ship it with the functions.
  outputFileTracingIncludes: { "/api/**": ["./data/**"] },
};

export default nextConfig;
