import { readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { defineConfig } from 'vite';

// Third-party PDF libraries (html2canvas, jsPDF) live in ./vendor and are loaded by
// classic <script> tags, so PDF export works without internet (ADR-013). Vite does not
// bundle classic scripts, so this build-only plugin copies each file (and its LICENSE)
// unchanged into the build's asset folder — `assets/` for dist, the root for the flat
// build — and points the <script src> at the copy. Dev server serves ./vendor directly.
const VENDOR_DIR = resolve(process.cwd(), 'vendor');
const VENDOR_LIBS = JSON.parse(readFileSync(resolve(VENDOR_DIR, 'vendor-manifest.json'), 'utf8')).libraries;

function offlineVendorScripts() {
  let config;
  const emittedPath = file => (config.build.assetsDir ? posix.join(config.build.assetsDir, file) : file);
  return {
    name: 'erp-offline-vendor-scripts',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        let out = html;
        for (const lib of VENDOR_LIBS) {
          const from = new RegExp(`(<script\\b[^>]*\\bsrc=["'])(?:\\./)?vendor/${lib.file.replace(/\./g, '\\.')}(["'])`, 'g');
          if (!from.test(out)) throw new Error(`index.html does not load vendor/${lib.file}`);
          out = out.replace(from, `$1${config.base}${emittedPath(lib.file)}$2`);
        }
        return out;
      }
    },
    generateBundle() {
      for (const lib of VENDOR_LIBS) {
        for (const file of [lib.file, lib.licenseFile]) {
          this.emitFile({ type: 'asset', fileName: emittedPath(file), source: readFileSync(resolve(VENDOR_DIR, file)) });
        }
      }
    }
  };
}

export default defineConfig(() => ({
  // Vercel serves the app from the domain root. Keep relative base for local
  // static previews or a future GitHub Pages build.
  base: process.env.VERCEL ? '/' : './',
  server: { port: 5173, host: '0.0.0.0' },
  preview: { port: 4173, host: '0.0.0.0' },
  plugins: [offlineVendorScripts()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html')
      }
    }
  }
}));
