import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';
import { FESTIE_RUNTIME_CACHING } from '@festie/shared/pwa';
import path from 'path';
import { execSync } from 'node:child_process';

// Build id for the Account version line and the Sentry release. Vitest keeps 'dev'.
function buildId(): string {
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION;
  if (process.env.VITEST) return 'dev';
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
}

const ADMIN_ONLY_SHARED = /[\\/]shared[\\/]src[\\/](utils[\\/]lineup(Import|Paste)|services[\\/](lineupImport|adminArtists))\.ts$/;

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(buildId()),
  },
  build: {
    chunkSizeWarningLimit: 600,
    target: 'es2022',
    cssCodeSplit: true,
    // Hidden maps exist only for the deploy build (scripts/deploy/deploy.py sets FESTIE_WEB_SOURCEMAPS=1),
    // which uploads them with scripts/ci/sentry-sourcemaps.mjs and then deletes them from dist/. The token
    // alone is not enough: it lives in a login shell that rollback and staging builds share.
    sourcemap: process.env.FESTIE_WEB_SOURCEMAPS === '1' && process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
    rolldownOptions: {
      output: {
        // Split the vendor bundle into logical chunks so the 697 KB index chunk
        // becomes a small shell + cacheable vendor groups. Parallel HTTP/2 load
        // plus cache longevity (react-core rarely changes; export-tools only
        // loads on Share/Export tap). Matches the bundle-viz treemap groupings.
        // Rolldown's legacy manualChunks always pulls a captured module's whole
        // dependency tree into its chunk, which dragged the admin-only lineup tools
        // into festie-shared. codeSplitting groups can turn that off.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            // One chunk for @festie/shared instead of ~15 tiny shared chunks: the
            // entry needs nearly all of it, and each chunk was its own
            // modulepreload request (37 -> 12 on first load, FCP -0.5s in Lighthouse).
            // The admin-only lineup tools stay out so only the lazy admin routes load them.
            {
              name: 'festie-shared',
              test: /[\\/]packages[\\/]shared[\\/]src[\\/]/,
              exclude: ADMIN_ONLY_SHARED,
              priority: 10,
            },
            { name: 'react-core', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 9 },
            { name: 'router', test: /@tanstack/, priority: 8 },
            { name: 'data', test: /zustand|socket\.io-client|[\\/]zod[\\/]/, priority: 7 },
            // motion re-exports framer-motion, motion-dom and motion-utils. Left out, they formed a
            // separate chunk that imported ui-motion while ui-motion imported it: a cycle that threw
            // "ie is not iterable" at load and left the app on "Loading Festie…".
            { name: 'ui-motion', test: /vaul|@radix-ui|[\\/](framer-)?motion(-dom|-utils)?[\\/]|@use-gesture/, priority: 6 },
            { name: 'icons', test: /lucide-react/, priority: 5 },
            { name: 'export-tools', test: /html-to-image/, priority: 4 },
            { name: 'telemetry', test: /@sentry|web-vitals|workbox/, priority: 3 },
            // maplibre-gl.mjs and maplibre-gl-shared.mjs are separate ES modules; one
            // merged chunk was 263 KB gzip, over the 250 KB per-file budget. Split, they
            // download in parallel, and only when a map mounts (CrewMap imports lazily).
            { name: 'maplibre-shared', test: /maplibre-gl-shared/, priority: 2 },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    process.env.ANALYZE && visualizer({ open: true, gzipSize: true, brotliSize: true }),
    VitePWA({
      registerType: 'autoUpdate',
      // Deferred, so the SW registration script never blocks first paint.
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Festie — Festival Planner',
        short_name: 'Festie',
        description: 'Plan your festival schedule with friends',
        theme_color: '#080810',
        background_color: '#080810',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Serve the SPA shell for client-routed navigations, but let real
        // server-rendered static pages (privacy/terms/etc., any *.html, the
        // API, and /.well-known) fall through to the network — otherwise the
        // service worker shadows them with index.html and the router 404s.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [
          /^\/privacy/,
          /^\/delete-account/,
          /^\/terms/,
          /^\/dmca/,
          /^\/security-whitepaper/,
          /\.html$/,
          /^\/third-party-notices\.txt$/,
          /^\/api/,
          /^\/\.well-known/,
          // Server-owned flows: password reset and crew-join links must hit the
          // network so the server can validate tokens / redirect correctly.
          // Without these the installed PWA intercepts them and serves index.html,
          // which means the token never reaches the server and the flow breaks.
          /^\/reset(\/|-password)/,
          /^\/join\//,
          // Server-rendered share pages and calendar feeds (/s/<token>, /s/u/<username>, /f/<slug>, /cal/<token>.ics).
          /^\/s\//,
          /^\/f\//,
          /^\/cal\//,
          // Files the server owns: crawlers, user uploads and Prometheus scrapes must not get the SPA shell.
          /^\/robots\.txt$/,
          /^\/sitemap\.xml$/,
          /^\/uploads\//,
          /^\/metrics/,
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Vite's manualChunks does not produce admin-prefixed filenames; the
        // original '**/admin-*.js' glob matched nothing in practice.  Dropped to
        // avoid a misleading no-op.  If admin-only chunks are later split out
        // with a known naming convention, add a targeted pattern here.
        // The share image is only fetched by link-preview crawlers; keep it out
        // of the install-time precache.
        globIgnores: ['og-image.png'],
        cleanupOutdatedCaches: true,
        // Web Push push/notificationclick handlers live in public/push-sw.js.
        importScripts: ['push-sw.js'],
        clientsClaim: true,
        skipWaiting: true,
        // THE GATE: the runtimeCaching rules are the single source of truth in
        // @festie/shared/pwa so the shipped SW and the cross-account boundary
        // test (sw-parity.test.ts) can never drift. Edit the rules there.
        runtimeCaching: FESTIE_RUNTIME_CACHING,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@festie/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        // Rewrite Origin header so Express CSRF check doesn't reject dev server origin
        headers: { Origin: 'http://127.0.0.1:4000' },
        // Strip Secure flag from cookies so they work over HTTP in dev
        cookieDomainRewrite: '',
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const sc = proxyRes.headers['set-cookie'];
            if (sc) {
              proxyRes.headers['set-cookie'] = (Array.isArray(sc) ? sc : [sc]).map((c) =>
                c.replace(/;\s*Secure/gi, '').replace(/;\s*SameSite=Strict/gi, '; SameSite=Lax'),
              );
            }
          });
        },
      },
      // Friend picks read /s/<ref>/json from the page's own origin; without this the dev server answers with the SPA shell.
      '^/s/[^/]+/json$': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        headers: { Origin: 'http://127.0.0.1:4000' },
      },
      '/socket.io': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:4000',
        changeOrigin: true,
        ws: true,
        headers: { Origin: 'http://127.0.0.1:4000' },
      },
    },
  },
});
