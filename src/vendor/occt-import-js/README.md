# occt-import-js (vendored build)

A rebuild of [occt-import-js](https://github.com/kovacsv/occt-import-js) 0.0.23
(commit `c2148e54b456b571238d35cac037d304053d64b2`, OCCT 7.6.1 `d2abb6d8`)
with two link-flag changes in its `CMakeLists.txt`:

- `-sMAXIMUM_MEMORY=4GB` — the npm release caps the wasm heap at 2 GB. Large
  assemblies exhaust it while tessellating, and OCCT still reports success but
  returns every mesh with no triangles. EBR Robot.step (1394 parts) peaks at
  ~2.8 GB.
- `-sEXPORT_ES6=1` — emits an ES module (`export default occtimportjs`) so the
  model worker can import it without CommonJS interop.

## Rebuilding

```sh
git clone https://github.com/kovacsv/occt-import-js.git && cd occt-import-js
git checkout 0.0.23
# The occt submodule host is unreliable; the GitHub mirror has the same commit:
git clone https://github.com/Open-Cascade-SAS/OCCT.git occt && git -C occt checkout d2abb6d8
# Apply the two flags above to the target_link_options in CMakeLists.txt, then:
git clone https://github.com/emscripten-core/emsdk.git ../emsdk
../emsdk/emsdk install 3.1.69 && ../emsdk/emsdk activate 3.1.69
source ../emsdk/emsdk_env.sh
emcmake cmake -B build/wasm -G "Unix Makefiles" -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release .
emmake make -C build/wasm -j
```

Copy `build/wasm/Release/occt-import-js.{js,wasm}` here. Licenses: OCCT is
LGPL 2.1 (`license.occt.txt`), occt-import-js is LGPL 2.1 (`license.occt-import-js.txt`).
