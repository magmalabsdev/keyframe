// Dev helper: load the running app in headless Chrome, capture a screenshot,
// and report any console/page errors. Uses the system Chrome via puppeteer-core
// (no browser download).
//
// Usage: node scripts/screenshot.mjs [url] [outPath] [waitMs]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5174/';
const out = process.argv[3] || '/tmp/keyframe-shot.png';
const waitMs = Number(process.argv[4] || 2800);

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--window-size=1680,1050',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1050, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('[console.error] ' + msg.text());
});
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
page.on('requestfailed', (req) =>
  errors.push(
    '[requestfailed] ' + req.url() + ' — ' + (req.failure()?.errorText ?? ''),
  ),
);

await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise((r) => setTimeout(r, waitMs));
await page.screenshot({ path: out });
await browser.close();

console.log('Screenshot saved to', out);
if (errors.length) {
  console.log('\n=== PAGE ERRORS (' + errors.length + ') ===');
  for (const e of errors) console.log(e);
  process.exitCode = 1;
} else {
  console.log('No console/page errors detected.');
}
