# keyframe

An easy-to-use, browser-based **3D animation app**. Import models, pose them with
Tinkercad/Roblox-style gizmos, keyframe their motion on a timeline, and export an
mp4 — all running on WebGL in the browser.

## Features

- **3D viewport** (Z-up): build-plate grid, 1600×900 mm camera framing rectangle,
  orbit / pan / zoom navigation (right-drag, middle-drag or WASD-EQ, wheel / ±),
  and an interactive perspective cube + named view buttons.
- **Import** STL, OBJ, glTF/GLB, and **STEP** (CAD, via an OpenCascade WASM module
  loaded on demand). Drag-and-drop or the Import button.
- **Manipulation**: move / scale / rotate gizmos (Shift snaps rotation to 15°),
  plus a full inspector for position/rotation/scale (mm / degrees), color with a
  preset palette, opacity, reflectivity, roughness, and visibility.
- **Animation**: per-object keyframes with linear / ease / step interpolation,
  object lifetimes, a scrubbable timeline, play/loop, and a keyframable camera.
- **Editing**: undo/redo, copy/paste/cut/duplicate, delete, select-all, autosave.
- **Files**: self-contained `.kfp` (one scene) and `.kfpx` (all scenes) save/load,
  and **mp4 video export** (deterministic, frame-by-frame, via WebCodecs).

## Tech stack

React + TypeScript + Vite, [react-three-fiber](https://github.com/pmndrs/react-three-fiber)
+ [drei](https://github.com/pmndrs/drei) over three.js, [zustand](https://github.com/pmndrs/zustand)
(+ immer, zundo for undo/redo), fflate (`.kfp`/`.kfpx` zips), idb-keyval (autosave),
occt-import-js (STEP), and mp4-muxer + WebCodecs (video export).

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm test         # unit tests (evaluator, serialization round-trip)
```

A Chromium-based browser (Chrome/Edge) is recommended — STEP import and mp4 export
rely on WASM and WebCodecs respectively.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `1` / `2` / `3` / `4` | Select / Move / Scale / Rotate tool |
| `K` | Add keyframe at playhead |
| `Space` | Play / pause |
| `⌘/Ctrl + Z` / `⇧Z` | Undo / redo |
| `⌘/Ctrl + C/X/V/D` | Copy / cut / paste / duplicate |
| `⌘/Ctrl + A` | Select all |
| `⌘/Ctrl + S` | Save (force autosave) |
| `Delete` / `Backspace` | Delete selected |
| `Esc` | Clear selection |

## Project layout

```
src/
  state/      document + editor stores, types, defaults
  animation/  pure interpolation evaluator, transform-edit (auto-key) helpers
  viewport/   R3F scene: build plate, camera rig, objects, gizmo, playback
  render/     off-loop rendering + WebCodecs mp4 export
  io/         model loaders, geometry cache, .kfp/.kfpx serialize, autosave
  ui/         top/left/right bars, inspector, timeline
  app/        layout, global shortcuts, persistence init, clipboard
scripts/      headless-Chrome verification helpers (dev only)
```

## Status

This is a working **vertical slice** of the spec: import, transform-keyframe
animation (with idle/start/end effects and a distinctive voxel/particle/polygon
"form" transition system), grouping, snapping, place-on-face, a multi-track
audio mixer, and deterministic mp4 export are all implemented. Not attempted:
skeletal rigging/IK, a curve/graph editor, physics/simulation, multi-camera or
cinematographic camera controls (DOF, motion blur), node-based shading, and
scene lighting/rendering quality (shadows, GI, post-processing) — see the
breakdown below.

## How it compares to professional animation/film tools

Keyframe is not trying to be a full DCC suite (Blender/Maya/Cinema 4D) or
compositor (After Effects) — it's a focused tool for keyframing rigid objects
on a build plate and exporting a video. The table below is an honest,
code-level estimate of how far each area of a typical professional pipeline
is implemented here, not a marketing claim.

| Production component | What's here | Est. % of pro-tool depth |
|---|---|:---:|
| Asset import | STL, OBJ, glTF/GLB, STEP (via WASM); no mesh editing/sculpting after import | ~25% |
| Keyframe animation & interpolation | Per-channel, per-axis keyframes; 5 easing presets (linear/ease-in/out/in-out/step); no bezier handles, no curve/graph editor, no animation layers | ~30% |
| Object hierarchy & grouping | Arbitrary-depth parent/child groups with correct transform composition; no constraints (look-at, path, IK) | ~40% |
| Rigging & skeletal animation | Absent — animation is rigid-body transform keyframing only, no bones/skinning/IK | 0% |
| Snapping & placement | Face-to-face AABB snapping, Bambu-style "place on face"; no vertex/edge/angle/grid snapping | ~35% |
| Camera & cinematography | Single camera, position+target keyframes; fixed FOV, no depth of field, motion blur, multi-cam switching, or dolly-zoom | ~20% |
| Lighting | Point/spot lights only; no shadows, no ambient/sun/area lights, no GI or HDRI/IBL | ~10% |
| Materials & shading | Color/opacity/metalness/roughness + one auto-projected texture; no node graph, no normal/AO/displacement maps, no real UV editing | ~15% |
| Rendering quality | Plain WebGL rasterization with antialiasing; no shadow maps, no post-processing (bloom/vignette/color grade), no ray/path tracing | ~10% |
| VFX & particles | A polished, purpose-built voxel/particle/polygon "form" transition (assemble/disperse); not a general particle system (no emitters, forces, or sim) | ~20%* |
| Physics & simulation | Absent — no rigid-body dynamics, cloth, or collision beyond simple AABB snap checks | 0% |
| Idle & transition animations | Rotate/pulse/wiggle/flicker idles, pop/fade/digital/form transitions, fully implemented with UI controls | ~55% |
| Audio | Multi-track mixer with clips, gain, mute, scrub-safe scheduling, and synced deterministic export; no waveform display, EQ, or automation | ~50% |
| Media, video textures & titles | Image/video/GIF textures (incl. as backgrounds and flat "surface" screens) and basic troika-text titles; no per-character motion graphics or arbitrary-UV video mapping | ~35% |
| Multi-scene / sequencing | Independent scenes bundled in one project file; no NLE-style edit timeline, cuts, or cross-scene batch export | ~20% |
| Export & delivery | One fixed preset (720p30, 8Mbps, MP4/H.264); no resolution/fps/codec choice, no alpha channel, no image-sequence export, no render queue | ~15% |
| Editing & workflow (undo/redo, autosave, copy/paste) | Full undo/redo, autosave, clipboard ops, self-contained `.kfp`/`.kfpx` save/load | ~65% |
| Collaboration & version control | Absent — single local document, no multi-user or history beyond undo | 0% |

\* Rated against "VFX/particle systems" as a category; as a standalone stylistic
effect, the form-transition implementation is one of the most complete
features in the app.

**Overall**: Keyframe is strongest as a lightweight, well-engineered tool for
animating and exporting stylized part/product reveals — its snapping,
grouping, audio sync, and "form" transitions are genuinely solid. It has none
of the foundational systems (rigging, a curve editor, physics, multi-camera,
lighting/shadows, a render queue) that define professional animation
software, and those gaps are intentional scope decisions rather than
half-finished work.
