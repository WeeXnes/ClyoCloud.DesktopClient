const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyAssets() {
  // Ensure dist directories
  fs.mkdirSync('dist/main', { recursive: true });
  fs.mkdirSync('dist/preload', { recursive: true });
  fs.mkdirSync('dist/renderer/styles', { recursive: true });
  fs.mkdirSync('dist/assets', { recursive: true });

  // Copy HTML
  fs.copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');

  // Copy Styles
  copyDirSync('src/renderer/styles', 'dist/renderer/styles');

  // Copy Assets
  if (fs.existsSync('assets')) {
    copyDirSync('assets', 'dist/assets');
  }
}

async function build() {
  console.log('==> Building ClyoCloud Desktop Client...');
  copyAssets();

  // 1. Main Process
  const mainCtx = await esbuild.context({
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/index.js',
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron', 'chokidar', 'mime-types'],
    sourcemap: true
  });

  // 2. Preload Script
  const preloadCtx = await esbuild.context({
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
    bundle: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    sourcemap: true
  });

  // 3. Renderer Script
  const rendererCtx = await esbuild.context({
    entryPoints: ['src/renderer/src/app.ts'],
    outfile: 'dist/renderer/app.js',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    sourcemap: true
  });

  if (isWatch) {
    await Promise.all([mainCtx.watch(), preloadCtx.watch(), rendererCtx.watch()]);
    console.log('==> Watching for changes...');
  } else {
    await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild(), rendererCtx.rebuild()]);
    await Promise.all([mainCtx.dispose(), preloadCtx.dispose(), rendererCtx.dispose()]);
    console.log('==> Build completed successfully in dist/');
  }
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
