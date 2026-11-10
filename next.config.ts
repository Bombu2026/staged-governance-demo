import type { NextConfig } from "next";

// No script-src: the statically generated page relies on Next.js inline bootstrap scripts, which a
// 'self'-only policy blocks (checked with and without experimental.sri). Nonces would need dynamic rendering.
const csp = ["img-src 'self' data:", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};

export default nextConfig;
