import { setView, type ViewName } from '../viewport/cameraApi';
import styles from './ViewControls.module.css';

const VIEWS: { name: ViewName; label: string }[] = [
  { name: 'top', label: 'Top' },
  { name: 'front', label: 'Front' },
  { name: 'right', label: 'Right' },
  { name: 'iso', label: 'Iso' },
  { name: 'back', label: 'Back' },
  { name: 'left', label: 'Left' },
];

export function ViewControls() {
  return (
    <div className={styles.wrap}>
      <div className={styles.label}>View</div>
      <div className={styles.grid}>
        {VIEWS.map((v) => (
          <button key={v.name} onClick={() => setView(v.name)} title={`${v.label} view`}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
