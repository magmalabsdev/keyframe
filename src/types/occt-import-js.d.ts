declare module 'occt-import-js' {
  export interface OcctAttribute {
    array: ArrayLike<number>;
  }
  export interface OcctMesh {
    name?: string;
    color?: [number, number, number];
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
  const factory: (options?: OcctInitOptions) => Promise<OcctModule>;
  export default factory;
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
