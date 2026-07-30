/**
 * Font subsystem: enumerating system fonts (Local Font Access API, Chromium),
 * importing font bytes into the project as `kind: 'font'` media assets (so
 * .kfp/.kfpx exports stay self-contained), and loading parsed three Fonts for
 * 3D text extrusion.
 *
 * Troika (flat surface text) consumes a font *URL* (`getFontUrl`); extrusion
 * consumes a parsed `Font` (`loadThreeFont`, TTFLoader -> FontLoader — handles
 * TTF, OTF and WOFF1, verified against the bundled Inter woff).
 */
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import {
  FontLoader,
  type Font,
  type FontData,
} from 'three/examples/jsm/loaders/FontLoader.js';
import { getMediaBlob, getMediaUrl } from './mediaCache';
import { importMediaFile } from './importMedia';

export const BUNDLED_FONT_URL = `${import.meta.env.BASE_URL}fonts/inter-regular.woff`;
export const BUNDLED_FONT_LABEL = 'Inter (built-in)';

/** FontData entries returned by window.queryLocalFonts (Chromium only). */
interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob: () => Promise<Blob>;
}

declare global {
  interface Window {
    queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFontData[]>;
  }
}

export interface SystemFontEntry {
  family: string;
  fullName: string;
  postscriptName: string;
}

export function supportsLocalFonts(): boolean {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function';
}

/**
 * Enumerates installed fonts, one entry per family (preferring the Regular
 * style). Must be called from a user gesture; throws if permission is denied.
 */
export async function listSystemFonts(): Promise<SystemFontEntry[]> {
  if (!window.queryLocalFonts) throw new Error('Local font access is not supported');
  const all = await window.queryLocalFonts();
  const byFamily = new Map<string, LocalFontData>();
  for (const f of all) {
    const existing = byFamily.get(f.family);
    if (!existing || (f.style === 'Regular' && existing.style !== 'Regular')) {
      byFamily.set(f.family, f);
    }
  }
  return [...byFamily.values()]
    .map(({ family, fullName, postscriptName }) => ({ family, fullName, postscriptName }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Copies a system font's bytes into the project as a font media asset and
 * returns its id (embedded into exports; survives reload via IndexedDB).
 */
export async function importSystemFont(entry: SystemFontEntry): Promise<string> {
  if (!window.queryLocalFonts) throw new Error('Local font access is not supported');
  const [data] = await window.queryLocalFonts({ postscriptNames: [entry.postscriptName] });
  if (!data) throw new Error(`Font "${entry.fullName}" not found`);
  const blob = await data.blob();
  const file = new File([blob], entry.fullName, { type: blob.type || 'font/ttf' });
  return importMediaFile(file, 'font');
}

/** Imports an uploaded .ttf/.otf/.woff file (works in every browser). */
export async function importFontFile(file: File): Promise<string> {
  const typed = file.type
    ? file
    : new File([file], file.name, { type: 'font/ttf' });
  return importMediaFile(typed, 'font');
}

/** Stable cache-key form of a font reference. */
export function fontKeyOf(fontId: string | undefined): string {
  return fontId ?? 'bundled';
}

const warnedMissing = new Set<string>();

/**
 * URL for troika's `font` prop: the embedded font's blob URL, or the bundled
 * font when unset or the blob hasn't hydrated (warned once per id).
 */
export function getFontUrl(fontId: string | undefined): string {
  if (!fontId) return BUNDLED_FONT_URL;
  const url = getMediaUrl(fontId);
  if (url) return url;
  if (!warnedMissing.has(fontId)) {
    warnedMissing.add(fontId);
    console.warn(`Font ${fontId} has no loaded data; using the bundled font.`);
  }
  return BUNDLED_FONT_URL;
}

const fontPromises = new Map<string, Promise<Font>>();

async function parseFont(buffer: ArrayBuffer): Promise<Font> {
  const json = new TTFLoader().parse(buffer) as FontData;
  return new FontLoader().parse(json);
}

/**
 * Parsed three Font for extrusion/layout. Cached per font id. Falls back to
 * the bundled font when the blob is missing (not cached, so a later hydration
 * retry succeeds) or fails to parse.
 */
export function loadThreeFont(fontId: string | undefined): Promise<Font> {
  if (!fontId) {
    let p = fontPromises.get('bundled');
    if (!p) {
      p = fetch(BUNDLED_FONT_URL)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to fetch bundled font (${r.status})`);
          return r.arrayBuffer();
        })
        .then(parseFont);
      fontPromises.set('bundled', p);
    }
    return p;
  }
  const cached = fontPromises.get(fontId);
  if (cached) return cached;
  const blob = getMediaBlob(fontId);
  if (!blob) return loadThreeFont(undefined);
  const p = blob
    .arrayBuffer()
    .then(parseFont)
    .catch((err) => {
      console.warn(`Font ${fontId} failed to parse; using the bundled font.`, err);
      return loadThreeFont(undefined);
    });
  fontPromises.set(fontId, p);
  return p;
}
