/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Static Export ──────────────────────────────────────────────────────
  // Produces a fully static site in out/ that Electron loads via loadFile()
  output: 'export',

  // ── Images ─────────────────────────────────────────────────────────────
  // Static export requires unoptimized images (no server-side optimization)
  images: {
    unoptimized: true,
  },

  // ── Trailing Slash ─────────────────────────────────────────────────────
  // Required for file:// protocol — ensures /login resolves to /login/index.html
  trailingSlash: true,

  // ── Asset Prefix ───────────────────────────────────────────────────────
  // Use relative paths for all assets so file:// protocol works
  assetPrefix: './',

  // ── Base Path (disabled for static file loading) ──────────────────────
  // basePath: '',

  // Disable server features not available in static export
  // rewrites, middleware, API routes etc. are NOT supported in export mode
};

module.exports = nextConfig;
