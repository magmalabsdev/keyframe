/**
 * A small, distinct icon per scene-object kind, used in both the object tree
 * (LeftBar) and the inspector's title row. Vector icons are inline SVGs sized
 * via `1em` (so the surrounding element's font-size controls their size) and
 * stroked with `currentColor` (so they inherit the surrounding text color,
 * following the same theming convention as the tree's other glyph buttons).
 *
 * 3D text is the one exception: it renders the literal text "Tt" (or, for a
 * single glyph child, that character) using the object's own chosen font, via
 * a lazily-loaded @font-face — the icon IS a live preview of the font.
 */
import { useEffect, useState } from 'react';
import type { Asset, SceneObject } from '../state/types';
import { fontKeyOf, getFontUrl } from '../io/fonts';

const fontFacePromises = new Map<string, Promise<string | undefined>>();

/** Registers a @font-face for `fontId` (once per font) and resolves its family name. */
function loadIconFontFamily(fontId: string | undefined): Promise<string | undefined> {
  const key = fontKeyOf(fontId);
  let p = fontFacePromises.get(key);
  if (!p) {
    const family = `kf-icon-font-${key.replace(/[^a-zA-Z0-9]/g, '')}`;
    p = new FontFace(family, `url(${getFontUrl(fontId)})`)
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        return family;
      })
      .catch(() => undefined);
    fontFacePromises.set(key, p);
  }
  return p;
}

/** The chosen font's family name once loaded; undefined (inherits the UI
 *  font) until then, so the icon never renders blank while it loads. */
function useIconFontFamily(fontId: string | undefined): string | undefined {
  const [family, setFamily] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadIconFontFamily(fontId).then((f) => {
      if (alive) setFamily(f);
    });
    return () => {
      alive = false;
    };
  }, [fontId]);
  return family;
}

const WireframeCubeIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M2 5 8 2 14 5 14 11 8 14 2 11Z" />
    <path d="M2 5 8 8 14 5M8 8V14" />
  </svg>
);

const GearsIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
    <circle cx="5.5" cy="5.5" r="2.5" />
    <circle cx="5.5" cy="5.5" r="0.6" fill="currentColor" stroke="none" />
    <path d="M5.5 3V1.9M5.5 8V9.1M3 5.5H1.9M8 5.5H9.1" />
    <circle cx="10.5" cy="10.5" r="1.8" />
    <circle cx="10.5" cy="10.5" r="0.5" fill="currentColor" stroke="none" />
    <path d="M10.5 8.7V7.8M10.5 12.3V13.2M8.7 10.5H7.8M12.3 10.5H13.2" />
  </svg>
);

const PlaneIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
    <path d="M2 10 7 4 14 6 9 12Z" />
  </svg>
);

const LightIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.5a4 4 0 0 0-2.2 7.3c.5.4.7.9.7 1.4v.3h3v-.3c0-.5.2-1 .7-1.4A4 4 0 0 0 8 1.5Z" />
    <path d="M6.3 13h3.4M6.7 14.3h2.6" />
  </svg>
);

const GroupIcon = () => (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.1">
    <rect x="2" y="2" width="8" height="8" rx="1" />
    <rect x="6" y="6" width="8" height="8" rx="1" />
  </svg>
);

/** Live preview of a text object's (or one glyph's) chosen font. */
function FontGlyphIcon({ fontId, char = 'Tt' }: { fontId: string | undefined; char?: string }) {
  const family = useIconFontFamily(fontId);
  return (
    <span style={{ fontFamily: family, fontSize: '0.85em', lineHeight: 1, fontWeight: 600 }}>
      {char}
    </span>
  );
}

export function ObjectTypeIcon({
  object,
  assets,
  parent,
}: {
  object: SceneObject;
  /** Geometry assets, to tell an imported mesh's format (STL vs STEP) apart. */
  assets?: Record<string, Asset>;
  /** The object's parent; only needed for a 'glyph' object, to read its
   *  parent text's chosen font. */
  parent?: SceneObject;
}) {
  switch (object.type) {
    case 'light':
      return <LightIcon />;
    case 'surface':
      return <PlaneIcon />;
    case 'group':
      return <GroupIcon />;
    case 'text':
      return <FontGlyphIcon fontId={object.text?.fontId} />;
    case 'glyph':
      return (
        <FontGlyphIcon
          fontId={parent?.type === 'text' ? parent.text?.fontId : undefined}
          char={object.glyph?.char ?? '?'}
        />
      );
    case 'mesh':
    default: {
      const format = object.assetId ? assets?.[object.assetId]?.format : undefined;
      return format === 'step' ? <GearsIcon /> : <WireframeCubeIcon />;
    }
  }
}
