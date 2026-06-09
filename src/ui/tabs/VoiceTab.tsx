import { useCallback, useEffect, useState } from 'react';
import type { LibraryItem } from '../../types';
import { getAllItems } from '../../storage';
import { isMessageOfType, onNotice } from '../../messaging';
import { AddManuallyForm } from '../AddManuallyForm';
import { LibraryItemRow } from '../LibraryItemRow';

type Filter = 'all' | 'post' | 'reply';

/**
 * Library management surface. Lists every `LibraryItem` with a
 * post/reply filter, inline edit, type override, and delete. The "add
 * manually" form sits at the top.
 *
 * Refresh triggers:
 *   - mount
 *   - any `bg:library-changed` notice (capture or manual add)
 *   - explicit `refresh()` after a local mutation (edit / delete)
 */
export function VoiceTab() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await getAllItems();
      all.sort((a, b) => b.createdAt - a.createdAt);
      setItems(all);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:library-changed')) void refresh();
    });
    return () => unsubscribe();
  }, [refresh]);

  const visible = filter === 'all' ? items : items.filter((i) => i.type === filter);

  return (
    <div className="tab-panel">
      <section>
        <h2>Add manually</h2>
        <AddManuallyForm onAdded={() => void refresh()} />
      </section>

      <section>
        <h2>Your library</h2>
        <div className="row">
          <FilterButton current={filter} value="all" setFilter={setFilter}>
            All ({items.length})
          </FilterButton>
          <FilterButton current={filter} value="post" setFilter={setFilter}>
            Posts ({items.filter((i) => i.type === 'post').length})
          </FilterButton>
          <FilterButton current={filter} value="reply" setFilter={setFilter}>
            Replies ({items.filter((i) => i.type === 'reply').length})
          </FilterButton>
        </div>

        {loading && <div className="stub">Loading…</div>}
        {error && <div className="status err">{error}</div>}
        {!loading && visible.length === 0 && (
          <div className="stub">
            Nothing here yet. Turn on capture mode and click your own tweets on x.com, or paste
            something above.
          </div>
        )}
        <ul className="lib-list">
          {visible.map((item) => (
            <LibraryItemRow key={item.id} item={item} onChanged={() => void refresh()} />
          ))}
        </ul>
      </section>
    </div>
  );
}

interface FilterButtonProps {
  current: Filter;
  value: Filter;
  setFilter: (f: Filter) => void;
  children: React.ReactNode;
}

function FilterButton({ current, value, setFilter, children }: FilterButtonProps) {
  return (
    <button
      type="button"
      className={`filter-btn ${current === value ? 'active' : ''}`}
      onClick={() => setFilter(value)}
    >
      {children}
    </button>
  );
}
