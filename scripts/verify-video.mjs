// Verifies Phase 6: build a short animation and export it to mp4 via WebCodecs.
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
  page.on('dialog', (d) => d.accept());
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    const kf = window.__kf;
    kf.doc.getState().removeObjects(kf.getActiveScene().objects.map((o) => o.id));
  });

  await (await page.$('input[accept*="stl"]')).uploadFile('/tmp/box.stl');
  await new Promise((r) => setTimeout(r, 1200));

  // Short 1.5s animation: move + rotate the box.
  const setup = await page.evaluate(() => {
    const kf = window.__kf;
    const id = kf.firstObjectId();
    kf.doc.getState().setSceneDuration(1500);
    kf.editor.getState().setPlayhead(0);
    kf.addKeyframeAtPlayhead(id);
    kf.editor.getState().setPlayhead(1500);
    kf.applyTransformEdit(id, {
      position: [500, 0, 300],
      rotation: [0, 0, 90],
      scale: [1.5, 1.5, 1.5],
    });
    return { keyframes: kf.getActiveScene().objects[0].keyframes.length };
  });
  log('Animation keyframes:', setup.keyframes);

  // Click Export video.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Export video'))
      ?.click();
  });

  // Poll for a finished, stable .mp4.
  let mp4 = null;
  let lastSize = -1;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const f = readdirSync(DL).find((n) => n.endsWith('.mp4'));
    if (f) {
      const size = statSync(`${DL}/${f}`).size;
      if (size > 0 && size === lastSize) {
        mp4 = `${DL}/${f}`;
        break;
      }
      lastSize = size;
    }
  }

  if (mp4) {
    const buf = readFileSync(mp4);
    const ftyp = buf.subarray(4, 8).toString('latin1');
    log('Exported mp4:', mp4, `${buf.length} bytes, box4-8="${ftyp}"`);
    log(ftyp === 'ftyp' && buf.length > 1000 ? 'VIDEO OK' : 'VIDEO SUSPECT');
  } else {
    log('No mp4 produced');
    process.exitCode = 1;
  }
} catch (err) {
  log('SCRIPT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  log('\n=== ERRORS ===');
  errors.forEach((e) => log(e));
}
