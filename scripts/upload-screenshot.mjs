// Dev helper: load the app, upload one or more model files to the import
// <input type=file>, wait, then screenshot. Reports console/page errors and any
// dialogs (which it auto-dismisses so they don't block headless Chrome).
//
// Usage: node scripts/upload-screenshot.mjs <outPath> <waitMs> <file...> [--url=...]
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const out = args.shift() || '/tmp/keyframe-upload.png';
const waitMs = Number(args.shift() || 6000);
const urlArg = args.find((a) => a.startsWith('--url='));
const url = urlArg ? urlArg.split('=')[1] : 'http://localhost:5174/';
const verbose = args.includes('--verbose');
const files = args.filter((a) => !a.startsWith('--'));

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 120000,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1680,1050',
  ],
});

const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1 });

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') errors.push('[console.error] ' + msg.text());
    else if (verbose) console.log(`[console.${t}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
  page.on('dialog', async (dialog) => {
    errors.push(`[dialog:${dialog.type()}] ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));

  if (files.length) {
    const input = await page.$('input[accept*="stl"]');
    if (!input) throw new Error('file input not found');
    await input.uploadFile(...files);
    console.log('Uploaded:', files.join(', '));
  }

  await new Promise((r) => setTimeout(r, waitMs));

  // Optional: --click=A,B clicks <button>s by text (in order) before screenshot.
  const clickArg = process.argv.find((a) => a.startsWith('--click='));
  if (clickArg) {
    for (const label of clickArg.split('=')[1].split(',')) {
      await page.evaluate((text) => {
        const btns = [...document.querySelectorAll('button')];
        const btn =
          btns.find((b) => b.textContent?.trim() === text) ||
          btns.find((b) => b.textContent?.includes(text));
        btn?.click();
      }, label);
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  await page.screenshot({ path: out });
  console.log('Screenshot saved to', out);
} catch (err) {
  console.log('SCRIPT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('\n=== PAGE EVENTS (' + errors.length + ') ===');
  for (const e of errors) console.log(e);
  process.exitCode = 1;
} else {
  console.log('No console/page errors detected.');
}
