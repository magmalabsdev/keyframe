import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { registerR3F } from './renderApi';

/** Registers the R3F root-state getter so the exporter can render off-loop. */
export function RenderRegistrar() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    registerR3F(get);
    return () => registerR3F(null);
  }, [get]);
  return null;
}
