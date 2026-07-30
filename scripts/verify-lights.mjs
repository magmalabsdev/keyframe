// Verifies scene lighting end-to-end: default light illuminates a fresh scene,
// deleting it goes dark, "+ Light" re-lights, light.intensity keyframes
// animate brightness, spread > 180 switches spot -> point, emitter meshes glow
// and cast light, and light proxies are hidden during render preview.
//
// Usage: node scripts/verify-lights.mjs [url] [boxStlPath]
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:5173/';
const boxStl = process.argv[3] || '/tmp/box.stl';
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

const errors = [];
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1050 });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1200));

  // Mean RGB of the center region of the WebGL canvas (preserveDrawingBuffer on).
  const centerColor = () =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      const gl = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const c = document.createElement('canvas');
      const size = 300;
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(
        gl,
        gl.width / 2 - size / 2,
        gl.height / 2 - size / 2,
        size,
        size,
        0,
        0,
        size,
        size,
      );
      const d = ctx.getImageData(0, 0, size, size).data;
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      return { r: r / n, g: g / n, b: b / n, lum: (r + g + b) / (3 * n) };
    });

  const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

  // Waits until the renderer has actually produced new frames. Changing the
  // visible-light count recompiles every material, which under SwiftShader
  // can take seconds — fixed sleeps sample a stale drawing buffer.
  const renderSettle = () =>
    page.evaluate(async () => {
      const root = window.__kf.getR3F();
      const frame = () => root.gl.info.render.frame;
      const start = frame();
      const t0 = performance.now();
      while (frame() < start + 2 && performance.now() - t0 < 10000) {
        root.invalidate();
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 150));
    });

  // A fresh document should contain exactly one default light object.
  const initial = await page.evaluate(() => {
    const kf = window.__kf;
    const objs = kf.getActiveScene().objects;
    return {
      lights: objs.filter((o) => o.type === 'light').length,
      lightId: objs.find((o) => o.type === 'light')?.id,
    };
  });
  check('new scene has one default light', initial.lights === 1);

  // Import the box, deselect it (the selection highlight is emissive and would
  // mask lighting changes), and view from the top: the default light points
  // straight down, so the top face is where illumination is measurable.
  const input = await page.$('input[accept*="stl"]');
  await input.uploadFile(boxStl);
  await settle(1500);
  await page.evaluate(() => {
    window.__kf.editor.getState().clearSelection();
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Top'))
      ?.click();
  });
  await settle(800);

  const lit = await centerColor();
  check('box is lit by the default light', lit.lum > 25, `lum=${lit.lum.toFixed(1)}`);

  // Deleting the light must leave the scene dark (no built-in lighting).
  await page.evaluate((id) => window.__kf.doc.getState().removeObjects([id]), initial.lightId);
  await renderSettle();
  const dark = await centerColor();
  check(
    'deleting the light goes dark',
    dark.lum < lit.lum * 0.45,
    `lum ${lit.lum.toFixed(1)} -> ${dark.lum.toFixed(1)}`,
  );

  // "+ Light" re-lights the scene through the real UI path.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === '+ Light')
      ?.click();
  });
  await page.evaluate(() => window.__kf.editor.getState().clearSelection());
  await renderSettle();
  const relit = await centerColor();
  const newLightId = await page.evaluate(
    () => window.__kf.getActiveScene().objects.find((o) => o.type === 'light')?.id,
  );
  check('"+ Light" re-lights the scene', !!newLightId && relit.lum > lit.lum * 0.6, `lum=${relit.lum.toFixed(1)}`);

  // Keyframed intensity: 0 at t=0 -> 8 at t=2000; the driven three.js light
  // should read ~4 at the midpoint and the viewport should brighten over time.
  await page.evaluate((id) => {
    const kf = window.__kf;
    const doc = kf.doc.getState();
    kf.editor.getState().setPlayhead(0);
    doc.cycleKeyframe(`object:${id}:light.intensity`, 0);
    doc.setChannelKeyframeValue(`object:${id}:light.intensity`, 0, 0);
    doc.setChannelKeyframeValue(`object:${id}:light.intensity`, 2000, 8);
  }, newLightId);
  await renderSettle();
  const dimStart = await centerColor();
  const midIntensity = await page.evaluate((id) => {
    const kf = window.__kf;
    kf.editor.getState().setPlayhead(1000);
    return new Promise((resolve) =>
      setTimeout(
        () => resolve(kf.getR3F().scene.getObjectByName(`${id}__spot`)?.intensity),
        400,
      ),
    );
  }, newLightId);
  await page.evaluate(() => window.__kf.editor.getState().setPlayhead(2000));
  await renderSettle();
  const brightEnd = await centerColor();
  check(
    'keyframed intensity drives the spot light',
    Math.abs(midIntensity - 4) < 0.2,
    `spot intensity at t=1000: ${midIntensity}`,
  );
  check(
    'brightness animates with the intensity keyframes',
    brightEnd.lum > dimStart.lum + 10,
    `lum ${dimStart.lum.toFixed(1)} -> ${brightEnd.lum.toFixed(1)}`,
  );

  // Spread > 180 switches to the omnidirectional point light (and back).
  const spread = await page.evaluate((id) => {
    const kf = window.__kf;
    kf.doc.getState().setObjectLight(id, { spreadDeg: 360 });
    return new Promise((resolve) =>
      setTimeout(() => {
        const scene = kf.getR3F().scene;
        const wide = {
          spot: scene.getObjectByName(`${id}__spot`)?.intensity,
          point: scene.getObjectByName(`${id}__point`)?.intensity,
        };
        kf.doc.getState().setObjectLight(id, { spreadDeg: 60 });
        setTimeout(() => {
          resolve({
            wide,
            narrow: {
              spot: scene.getObjectByName(`${id}__spot`)?.intensity,
              point: scene.getObjectByName(`${id}__point`)?.intensity,
            },
          });
        }, 400);
      }, 400),
    );
  }, newLightId);
  check(
    'spread > 180 uses the point light',
    spread.wide.point > 0 && spread.wide.spot === 0,
    JSON.stringify(spread.wide),
  );
  check(
    'spread <= 180 uses the spot light',
    spread.narrow.spot > 0 && spread.narrow.point === 0,
    JSON.stringify(spread.narrow),
  );

  // Emitter mesh: with no light objects, an emitting box must glow (red) and
  // light itself.
  await page.evaluate((id) => {
    const kf = window.__kf;
    kf.doc.getState().removeObjects([id]);
    const boxId = kf.getActiveScene().objects.find((o) => o.type === 'mesh')?.id;
    kf.doc
      .getState()
      .setObjectLight(boxId, { enabled: true, color: '#ff4400', intensity: 6 });
  }, newLightId);
  await renderSettle();
  const glow = await centerColor();
  check(
    'emitter mesh glows in an otherwise dark scene',
    glow.lum > dark.lum + 10 && glow.r > glow.b + 10,
    `lum=${glow.lum.toFixed(1)} r=${glow.r.toFixed(1)} b=${glow.b.toFixed(1)}`,
  );
  const emitterRig = await page.evaluate(() => {
    const kf = window.__kf;
    const boxId = kf.getActiveScene().objects.find((o) => o.type === 'mesh')?.id;
    return kf.getR3F().scene.getObjectByName(`${boxId}__spot`)?.intensity;
  });
  check('emitter mesh carries a driven light rig', emitterRig > 0, `spot=${emitterRig}`);

  // Light proxies are editor-only: hidden during render preview.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === '+ Light')
      ?.click();
  });
  await settle();
  const proxy = await page.evaluate(() => {
    const kf = window.__kf;
    const lightId = kf.getActiveScene().objects.find((o) => o.type === 'light')?.id;
    const scene = kf.getR3F().scene;
    const before = scene.getObjectByName(`${lightId}__mesh`)?.visible;
    kf.editor.getState().setRenderPreview(true);
    return new Promise((resolve) =>
      setTimeout(() => {
        const during = scene.getObjectByName(`${lightId}__mesh`)?.visible;
        const flagged = scene.getObjectByName(`${lightId}__mesh`)?.userData
          .excludeFromRender;
        kf.editor.getState().setRenderPreview(false);
        resolve({ before, during, flagged });
      }, 400),
    );
  });
  check(
    'light proxy hidden in render preview and flagged for export',
    proxy.before === true && proxy.during === false && proxy.flagged === true,
    JSON.stringify(proxy),
  );

  await page.screenshot({ path: '/tmp/kf-lights-final.png' });
} catch (err) {
  console.log('SCRIPT ERROR:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('\n=== PAGE ERRORS ===');
  errors.forEach((e) => console.log(e));
  process.exitCode = 1;
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log('\nAll lighting checks passed.');
}
