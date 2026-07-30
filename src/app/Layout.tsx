import { TopBar } from '../ui/TopBar';
import { LeftBar } from '../ui/LeftBar';
import { RightBar } from '../ui/RightBar';
import { BottomBar } from '../ui/BottomBar';
import { ContextMenu } from '../ui/ContextMenu';
import { ShortcutHelp } from '../ui/ShortcutHelp';
import { Viewport } from '../viewport/Viewport';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useInitPersistence } from './useInitPersistence';
import { useAudioPlayback } from './useAudioPlayback';
import { useResizableLayout } from './useResizableLayout';
import type { CSSProperties } from 'react';
import styles from './Layout.module.css';

export function Layout() {
  useGlobalShortcuts();
  useInitPersistence();
  useAudioPlayback();
  const { size, startDrag } = useResizableLayout();

  const sizeVars = {
    '--left-w': `${size.leftW}px`,
    '--right-w': `${size.rightW}px`,
    '--bottom-h': `${size.bottomH}px`,
  } as CSSProperties;

  return (
    <div className={styles.layout} style={sizeVars}>
      <div className={styles.top}>
        <TopBar />
      </div>
      <div className={styles.left}>
        <LeftBar />
      </div>
      <main className={styles.center}>
        <Viewport />
      </main>
      <div className={styles.right}>
        <RightBar />
      </div>
      <div className={styles.bottom}>
        <BottomBar />
      </div>

      <div
        className={`${styles.resizer} ${styles.resizerLeft}`}
        onPointerDown={startDrag('left')}
        title="Drag to resize"
      />
      <div
        className={`${styles.resizer} ${styles.resizerRight}`}
        onPointerDown={startDrag('right')}
        title="Drag to resize"
      />
      <div
        className={`${styles.resizer} ${styles.resizerBottom}`}
        onPointerDown={startDrag('bottom')}
        title="Drag to resize"
      />

      <ContextMenu />
      <ShortcutHelp />
    </div>
  );
}
