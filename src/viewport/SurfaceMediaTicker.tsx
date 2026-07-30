import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useActiveScene, useDocumentStore } from '../state/documentStore';
import { updateAnimatedTextures } from '../render/mediaTextures';

/**
 * Keeps video and animated-GIF surfaces moving under the on-demand frameloop.
 *
 * One shared loop for the whole scene rather than one per surface: video
 * textures refresh themselves but still need a frame requested, and GIFs need
 * their backing <img> re-uploaded each frame.
 */
export function SurfaceMediaTicker() {
  const objects = useActiveScene().objects;
  const media = useDocumentStore((s) => s.project.media);
  const invalidate = useThree((s) => s.invalidate);

  let hasVideo = false;
  let hasGif = false;
  for (const obj of objects) {
    const asset = obj.surface?.mediaId ? media[obj.surface.mediaId] : undefined;
    if (!asset || obj.surface?.content === 'text' || !obj.visible) continue;
    if (asset.kind === 'video') hasVideo = true;
    else if (asset.mimeType === 'image/gif') hasGif = true;
  }

  useEffect(() => {
    if (!hasVideo && !hasGif) return;
    let raf = 0;
    const tick = () => {
      if (hasGif) updateAnimatedTextures();
      invalidate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasVideo, hasGif, invalidate]);

  return null;
}
