import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useActiveScene, useDocumentStore } from '../state/documentStore';
import { getBackgroundTexture, updateAnimatedBackgroundTextures } from '../render/mediaTextures';

/**
 * Sets the viewport background from the active scene's background color, or
 * (when set) a 2D image/gif/video media asset.
 */
export function SceneBackground() {
  const scene = useActiveScene();
  const three = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const { backgroundColor, backgroundMediaId } = scene.settings;
  const media = useDocumentStore((s) =>
    backgroundMediaId ? s.project.media[backgroundMediaId] : undefined,
  );

  useEffect(() => {
    if (!media) return;
    const texture = getBackgroundTexture(media);
    if (!texture) return;
    three.background = texture;
    return () => {
      three.background = null;
    };
  }, [three, media]);

  // Animated GIF/video backgrounds need continuous frames in demand mode.
  useEffect(() => {
    if (!media || (media.kind !== 'video' && media.mimeType !== 'image/gif')) return;
    let raf = 0;
    const tick = () => {
      if (media.mimeType === 'image/gif') updateAnimatedBackgroundTextures();
      invalidate();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media, invalidate]);

  if (media) return null;
  return <color attach="background" args={[backgroundColor]} />;
}
