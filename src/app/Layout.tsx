import { TopBar } from '../ui/TopBar';
import { LeftBar } from '../ui/LeftBar';
import { RightBar } from '../ui/RightBar';
import { BottomBar } from '../ui/BottomBar';
import { Viewport } from '../viewport/Viewport';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { useInitPersistence } from './useInitPersistence';
import styles from './Layout.module.css';

export function Layout() {
  useGlobalShortcuts();
  useInitPersistence();
  return (
    <div className={styles.layout}>
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
    </div>
  );
}
