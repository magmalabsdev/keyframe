import { ViewControls } from './ViewControls';
import { Inspector } from './inspector/Inspector';
import styles from './RightBar.module.css';

export function RightBar() {
  return (
    <div className={styles.bar}>
      {/* The interactive perspective cube lives in the viewport's top-right
          corner; these buttons give quick named-view snapping. */}
      <div className={styles.cubeSlot}>
        <ViewControls />
      </div>

      <Inspector />
    </div>
  );
}
