/** Types for the vendored occt-import-js build (see README.md). */
export interface OcctAttribute {
  array: ArrayLike<number>;
}
export interface OcctBrepFace {
  first: number;
  last: number;
  color: [number, number, number] | null;
}
export interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  brep_faces?: OcctBrepFace[];
  attributes: {
    position: OcctAttribute;
    normal?: OcctAttribute;
  };
  index?: OcctAttribute;
}
export interface OcctReadResult {
  success: boolean;
  root?: unknown;
  meshes: OcctMesh[];
}
export interface OcctModule {
  ReadStepFile(buffer: Uint8Array, params: unknown): OcctReadResult;
  ReadIgesFile?(buffer: Uint8Array, params: unknown): OcctReadResult;
  ReadBrepFile?(buffer: Uint8Array, params: unknown): OcctReadResult;
}
export interface OcctInitOptions {
  locateFile?: (path: string) => string;
}
declare const factory: (options?: OcctInitOptions) => Promise<OcctModule>;
export default factory;
