import { useEffect } from 'react';
import { startAudioEngine } from '../render/audioEngine';

/** Mounts the Web Audio engine that plays timeline audio in sync with the playhead. */
export function useAudioPlayback(): void {
  useEffect(() => startAudioEngine(), []);
}
