// Verifies Phase 5 I/O: import -> autosave -> reload restores; export .kfp
// (capturing the download) -> open it back. Avoids deleting the IndexedDB
// (which would invalidate idb-keyval's cached connection); uses unique markers
// and in-app scene clearing for clean assertions.
import puppeteer from 'puppeteer-core';
import { mkdirSync, readdirSync, rmSync, readFileSync, statSync } from 'fs';

const url = 'http://localhost:5174/';
const DL = '/tmp/kf-downloads';
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

const errors = [];
const log = (...a) => console.log(...a);

try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 700));

  // Start from a clean scene (remove anything a prior autosave restored).
  await page.evaluate(() => {
    const kf = window.__kf;
    const ids = kf.getActiveScene().objects.map((o) => o.id);
    kf.doc.getState().removeObjects(ids);
  });

  await (await page.$('input[accept*="stl"]')).uploadFile('/tmp/box.stl');
  await new Promise((r) => setTimeout(r, 1200));

  const before = await page.evaluate(async () => {
    const kf = window.__kf;
    const id = kf.firstObjectId();
    kf.addKeyframeAtPlayhead(id);
    kf.doc.getState().setProjectName('IO Test');
    await kf.saveNow();
    const scene = kf.getActiveScene();
    return { objects: scene.objects.length, keyframes: scene.objects[0]?.keyframes.length ?? 0 };
  });
  log('Before reload (saved):', JSON.stringify(before));

  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const restored = await page.evaluate(() => {
    const scene = window.__kf.getActiveScene();
    return {
      name: window.__kf.doc.getState().project.name,
      objects: scene.objects.length,
      keyframes: scene.objects[0]?.keyframes.length ?? 0,
    };
  });
  log('After reload (restored):', JSON.stringify(restored));

  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Export .kfp')
      ?.click();
  });
  let kfp = null;
  for (let i = 0; i < 40 && !kfp; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const f = readdirSync(DL).find((n) => n.endsWith('.kfp'));
    if (f && statSync(`${DL}/${f}`).size > 0) kfp = `${DL}/${f}`;
  }
  await new Promise((r) => setTimeout(r, 300));
  const bytes = kfp ? readFileSync(kfp) : null;
  log('Exported .kfp:', kfp, bytes ? `${bytes.length} bytes, magic ${bytes.subarray(0, 2).toString('latin1')}` : 'MISSING');

  // Open into a fresh page; clear its scene first so we know the open did it.
  const page2 = await browser.newPage();
  page2.on('pageerror', (e) => errors.push('open: ' + e.message));
  await page2.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 700));
  await page2.evaluate(() => {
    const kf = window.__kf;
    const ids = kf.getActiveScene().objects.map((o) => o.id);
    kf.doc.getState().removeObjects(ids);
    kf.doc.getState().setProjectName('EMPTY');
  });
  await (await page2.$('input[accept=".kfp,.kfpx"]')).uploadFile(kfp);
  await new Promise((r) => setTimeout(r, 1500));
  const opened = await page2.evaluate(() => {
    const scene = window.__kf.getActiveScene();
    return {
      name: window.__kf.doc.getState().project.name,
      objects: scene.objects.length,
      keyframes: scene.objects[0]?.keyframes.length ?? 0,
    };
  });
  log('After open .kfp:', JSON.stringify(opened));
  await page2.screenshot({ path: '/tmp/kf-io-open.png' });
} catch (err) {
  log('SCRIPT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  log('\n=== ERRORS ===');
  errors.forEach((e) => log(e));
  process.exitCode = 1;
} else {
  log('No console/page errors.');
}
