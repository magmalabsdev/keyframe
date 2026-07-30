// Verifies flat polygonal surfaces end-to-end: "+ Surface" adds a visible
// polygon, shape presets and vertex edits retriangulate it, text renders via
// troika, color/opacity keyframes animate it, the on-surface tool parents an
// aligned surface to a clicked face, and a surface + its media survive a
// .kfp round-trip.
//
// Usage: node scripts/verify-surfaces.mjs [url] [boxStlPath]
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

  const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

  // Waits until the renderer has actually produced new frames; the frameloop is
  // on-demand, so a fixed sleep can sample a stale drawing buffer.
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

  const centerColor = () =>
    page.evaluate(() => {
      const canvases = [...document.querySelectorAll('canvas')];
      const gl = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const c = document.createElement('canvas');
      const size = 300;
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(gl, gl.width / 2 - size / 2, gl.height / 2 - size / 2, size, size, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      return { r: r / n, g: g / n, b: b / n, lum: (r + g + b) / (3 * n) };
    });

  const clickButton = (label) =>
    page.evaluate((text) => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === text,
      );
      btn?.click();
      return !!btn;
    }, label);

  // --- 1. "+ Surface" creates a real, visible, selectable object ------------
  const added = await clickButton('+ Surface');
  await renderSettle();
  const surf = await page.evaluate(() => {
    const kf = window.__kf;
    const o = kf.getActiveScene().objects.find((x) => x.type === 'surface');
    if (!o) return null;
    const scene = kf.getR3F().scene;
    const mesh = scene.getObjectByName(`${o.id}__mesh`);
    return {
      id: o.id,
      points: o.surface?.points?.length,
      content: o.surface?.content,
      hasMesh: !!mesh,
      triangles: mesh?.geometry?.getIndex()?.count,
      hasBounds: !!mesh?.geometry?.boundingBox,
      selected: kf.editor.getState().selectedIds.includes(o.id),
    };
  });
  check('"+ Surface" button exists', added);
  check('creates a surface object', !!surf && surf.content === 'image', JSON.stringify(surf));
  check('renders a pickable __mesh with geometry', !!surf?.hasMesh && surf.triangles === 6, `indices=${surf?.triangles}`);
  check('geometry has bounds for marquee/raycast', !!surf?.hasBounds);
  check('new surface is selected', !!surf?.selected);

  const surfaceId = surf.id;

  // The surface should actually be drawn. Look down the Z axis first: a
  // surface lies in its local XY plane, so from the default Front view it is
  // edge-on and contributes nothing to measure.
  await page.evaluate(() => {
    window.__kf.editor.getState().clearSelection();
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Top')
      ?.click();
  });
  await settle(800);
  await renderSettle();
  const withSurface = await centerColor();
  await page.evaluate((id) => window.__kf.doc.getState().setObjectVisible(id, false), surfaceId);
  await renderSettle();
  const withoutSurface = await centerColor();
  await page.evaluate((id) => window.__kf.doc.getState().setObjectVisible(id, true), surfaceId);
  await renderSettle();
  check(
    'surface is actually rendered',
    withSurface.lum > withoutSurface.lum + 3,
    `lum ${withoutSurface.lum.toFixed(1)} -> ${withSurface.lum.toFixed(1)}`,
  );

  // --- 2. Polygon editing retriangulates ------------------------------------
  const shapes = await page.evaluate(async (id) => {
    const kf = window.__kf;
    const scene = kf.getR3F().scene;
    const tris = () => scene.getObjectByName(`${id}__mesh`)?.geometry?.getIndex()?.count;
    const out = {};
    kf.doc.getState().setObjectSurface(id, {
      points: [[-60, -60], [60, -60], [0, 60]],
    });
    await new Promise((r) => setTimeout(r, 400));
    out.triangle = tris();
    // Clockwise input must be normalized to CCW by the store action.
    kf.doc.getState().setObjectSurface(id, {
      points: [[-50, 50], [50, 50], [50, -50], [-50, -50]],
    });
    await new Promise((r) => setTimeout(r, 400));
    const pts = kf.getActiveScene().objects.find((o) => o.id === id).surface.points;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      area += x1 * y2 - x2 * y1;
    }
    out.ccwArea = area / 2;
    // A concave L-shape must triangulate into more than 2 triangles.
    kf.doc.getState().setObjectSurface(id, {
      points: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]],
    });
    await new Promise((r) => setTimeout(r, 400));
    out.concave = tris();
    return out;
  }, surfaceId);
  check('triangle preset triangulates to 1 triangle', shapes.triangle === 3, `indices=${shapes.triangle}`);
  check('clockwise points are normalized to CCW', shapes.ccwArea > 0, `area=${shapes.ccwArea}`);
  check('concave polygon triangulates', shapes.concave >= 12, `indices=${shapes.concave}`);

  // --- 3. Text content renders through troika -------------------------------
  await page.evaluate((id) => {
    const kf = window.__kf;
    kf.doc.getState().setObjectSurface(id, {
      content: 'text',
      text: 'HELLO',
      fontSize: 60,
      showBackground: false,
      points: [[-200, -80], [200, -80], [200, 80], [-200, 80]],
    });
    kf.doc.getState().setObjectMaterial(id, { color: '#ffffff' });
  }, surfaceId);
  await settle(1500); // troika lays glyphs out in a worker
  await renderSettle();

  const text = await page.evaluate((id) => {
    const scene = window.__kf.getR3F().scene;
    const t = scene.getObjectByName(`${id}__text`);
    if (!t) return { present: false };
    const g = t.geometry;
    return {
      present: true,
      troikaFlag: t.userData?.troikaText === true,
      // GlyphsGeometry instances one quad per glyph.
      glyphs: g?.attributes?.aTroikaGlyphBounds?.count ?? g?.instanceCount ?? null,
      materialIsArray: Array.isArray(t.material),
      notPickable: t.raycast() === null || t.raycast() === undefined,
    };
  }, surfaceId);
  check('text surface mounts a __text node', text.present && text.troikaFlag, JSON.stringify(text));
  check('glyphs were laid out ("HELLO" = 5)', text.glyphs === 5, `glyphs=${text.glyphs}`);
  check('material is not an array (no outline props)', text.materialIsArray === false);

  const textLum = await centerColor();
  check('text is visibly rendered', textLum.lum > withoutSurface.lum + 2, `lum=${textLum.lum.toFixed(1)}`);
  await page.screenshot({ path: '/tmp/kf-surface-text.png' });

  // --- 4. Pose driver animates a surface's color and opacity ----------------
  const posed = await page.evaluate(async (id) => {
    const kf = window.__kf;
    const doc = kf.doc.getState();
    kf.editor.getState().setPlayhead(0);
    doc.cycleKeyframe(`object:${id}:opacity`, 0);
    doc.setChannelKeyframeValue(`object:${id}:opacity`, 0, 0);
    doc.setChannelKeyframeValue(`object:${id}:opacity`, 2000, 1);
    doc.cycleKeyframe(`object:${id}:color`, 0);
    doc.setChannelKeyframeValue(`object:${id}:color`, 0, '#ff0000');
    doc.setChannelKeyframeValue(`object:${id}:color`, 2000, '#00ff00');

    const read = async (t) => {
      kf.editor.getState().setPlayhead(t);
      await new Promise((r) => setTimeout(r, 500));
      const node = kf.getR3F().scene.getObjectByName(`${id}__text`);
      const m = Array.isArray(node.material) ? node.material.at(-1) : node.material;
      return { opacity: m.opacity, color: m.color.getHexString() };
    };
    return { start: await read(0), mid: await read(1000), end: await read(2000) };
  }, surfaceId);
  check(
    'opacity keyframes drive the text material',
    posed.start.opacity < 0.05 && posed.end.opacity > 0.95,
    `${posed.start.opacity.toFixed(2)} -> ${posed.end.opacity.toFixed(2)}`,
  );
  check(
    'color keyframes drive the text material',
    posed.start.color === 'ff0000' && posed.end.color === '00ff00',
    `${posed.start.color} -> ${posed.mid.color} -> ${posed.end.color}`,
  );
  await page.evaluate(() => window.__kf.editor.getState().setPlayhead(2000));

  // --- 5. On-surface tool parents an aligned surface to a clicked face ------
  const input = await page.$('input[accept*="stl"]');
  await input.uploadFile(boxStl);
  await settle(1800);

  const onFace = await page.evaluate(async () => {
    const kf = window.__kf;
    const root = kf.getR3F();
    const box = kf.getActiveScene().objects.find((o) => o.type === 'mesh');
    if (!box) return { error: 'no imported mesh' };
    const mesh = root.scene.getObjectByName(`${box.id}__mesh`);

    // Raycast straight down onto the box, exactly as the tool's click does, so
    // this exercises the same faceIndex/normal the UI would produce. Cast from
    // above the mesh's WORLD position (geometry-local bounds would miss once
    // the importer staggers the part). Vector3s are cloned off existing
    // objects to avoid importing three into the page.
    mesh.updateMatrixWorld(true);
    const world = mesh.getWorldPosition(mesh.position.clone());
    const origin = mesh.position.clone().set(world.x, world.y, world.z + 2000);
    const direction = mesh.position.clone().set(0, 0, -1);
    root.raycaster.set(origin, direction);
    const hits = root.raycaster.intersectObject(mesh, false);
    const hit = hits[0];
    if (!hit || hit.faceIndex == null) {
      return { error: `raycast missed the box (origin z=${origin.z}, hits=${hits.length})` };
    }

    kf.createSurfaceOnFace(box.id, mesh, hit.faceIndex, hit.face.normal);
    await new Promise((r) => setTimeout(r, 600));
    const objs = kf.getActiveScene().objects;
    const decal = objs.find((o) => o.type === 'surface' && o.parentId === box.id);
    if (!decal) return { error: 'no surface created', before, after: objs.length };
    const node = kf.getR3F().scene.getObjectByName(decal.id);
    const parentNode = kf.getR3F().scene.getObjectByName(box.id);
    return {
      parented: decal.parentId === box.id,
      // The prerequisite fix: a surface under a mesh must actually mount.
      mounted: !!node,
      mountedUnderHost: !!node && !!parentNode && node.parent === parentNode,
      rotation: decal.transform.rotation.map((r) => Math.round(r)),
      z: decal.transform.position[2],
      boxTopZ: mesh.geometry.boundingBox?.max.z,
      inLeftBar: !!document.body.textContent?.includes(decal.name),
    };
  });

  if (onFace.error) {
    check('on-surface tool places a decal', false, onFace.error);
  } else {
    check('surface is parented to the clicked host', onFace.parented);
    check('surface parented to a mesh actually mounts', onFace.mounted && onFace.mountedUnderHost, JSON.stringify({ mounted: onFace.mounted, underHost: onFace.mountedUnderHost }));
    check('surface lies flat on an upward face', onFace.rotation.every((r) => Math.abs(r) < 1), `rot=${onFace.rotation}`);
    check('surface sits just above the face', Math.abs(onFace.z - (onFace.boxTopZ + 0.5)) < 0.01, `z=${onFace.z} face=${onFace.boxTopZ}`);
    check('child surface appears in the object list', onFace.inLeftBar);
  }
  await page.screenshot({ path: '/tmp/kf-surface-onface.png' });

  // --- 6. Round-trip through the .kfp container -----------------------------
  const roundTrip = await page.evaluate(async (id) => {
    const kf = window.__kf;
    const mod = await import('/src/io/serialize.ts');
    const project = kf.doc.getState().project;
    const scene = kf.getActiveScene();
    const bytes = await mod.serializeProject(project, [scene.id]);
    const out = mod.parseProjectContainer(bytes);
    const before = scene.objects.find((o) => o.id === id).surface;
    const after = out.project.scenes[0].objects.find((o) => o.id === id)?.surface;
    return {
      surfaces: out.project.scenes[0].objects.filter((o) => o.type === 'surface').length,
      textMatches: after?.text === before.text,
      pointsMatch: JSON.stringify(after?.points) === JSON.stringify(before.points),
      fontMatches: after?.fontSize === before.fontSize,
      version: out.project.version,
    };
  }, surfaceId);
  check('surfaces survive a .kfp round-trip', roundTrip.surfaces >= 2, `count=${roundTrip.surfaces}`);
  check('surface params survive the round-trip', roundTrip.textMatches && roundTrip.pointsMatch && roundTrip.fontMatches, JSON.stringify(roundTrip));
  check('document version is stamped', roundTrip.version === 4, `v=${roundTrip.version}`);

  await page.screenshot({ path: '/tmp/kf-surface-final.png' });
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
  console.log('\nAll surface checks passed.');
}
