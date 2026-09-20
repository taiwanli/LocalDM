import type { Category, StatusBucket, StatusCounters } from '@shared/types';
import { CATEGORY_LABELS } from '@shared/types';

interface Props {
  bucket: StatusBucket;
  category: Category | null;
  counts: StatusCounters;
  onBucket: (b: StatusBucket) => void;
  onCategory: (c: Category | null) => void;
}

const BUCKETS: { id: StatusBucket; label: string }[] = [
  { id: 'all', label: '所有下载' },
  { id: 'active', label: '正在下载' },
  { id: 'completed', label: '已完成' },
];

export function Sidebar({ bucket, category, counts, onBucket, onCategory }: Props) {
  return (
    <aside className="sidebar glass-thin">
      <div className="section-label">类别</div>
      {BUCKETS.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`side-item${bucket === b.id && !category ? ' is-active' : ''}`}
          onClick={() => {
            onBucket(b.id);
            onCategory(null);
          }}
        >
          <span>{b.label}</span>
          <span className="count mono">{counts[b.id]}</span>
        </button>
      ))}
      <div className="section-label">分类</div>
      {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
        <button
          key={c}
          type="button"
          className={`side-item${category === c ? ' is-active' : ''}`}
          onClick={() => {
            onCategory(category === c ? null : c);
            onBucket('all');
          }}
        >
          <span>{CATEGORY_LABELS[c]}</span>
          <span className="count mono">{counts.byCategory[c] ?? 0}</span>
        </button>
      ))}
      <style>{`
        .sidebar {
          border-radius: var(--radius-lg);
          padding: var(--space-3) var(--space-2);
          overflow: auto;
        }
        .section-label {
          font-size: var(--text-12);
          color: var(--label-secondary);
          padding: var(--space-2) var(--space-2) var(--space-1);
        }
        .side-item {
          width: 100%;
          height: 36px;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--space-2);
          color: var(--label);
          font-size: var(--text-13);
        }
        .side-item:hover { background: var(--fill); }
        .side-item.is-active {
          background: var(--tint-soft);
          color: var(--tint);
          font-weight: 500;
        }
        .count { font-size: var(--text-12); color: var(--label-secondary); }
        .side-item.is-active .count { color: var(--tint); }
      `}</style>
    </aside>
  );
}
