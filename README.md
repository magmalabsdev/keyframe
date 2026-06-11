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

This is a working **vertical slice** of the full spec. Deferred (in rough order):
object grouping, bespoke Roblox/Tinkercad gizmo behaviors (freedrag, place-on-face,
move center-of-rotation), object snapping, idle/start/end animations, and
multi-scene timeline polish.
