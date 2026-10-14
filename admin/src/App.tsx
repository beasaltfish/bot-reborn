import { useState, type ReactNode } from 'react';
import { CharacterList } from './CharacterList';
import { NewCharacter } from './NewCharacter';
import { useCharacters } from './useCharacters';
import { t } from './i18n';
import type { EditorSlot, TabName } from './types';

export function App({ pollMs = 2000, renderEditor }: {
  pollMs?: number;
  renderEditor: (props: EditorSlot) => ReactNode;
}) {
  const { list, down, refresh } = useCharacters(pollMs);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [initialTab, setInitialTab] = useState<TabName>('basic');

  const banner = down ? <div className="banner" role="status">{t('serverDown')}</div> : null;
  if (list === null) return <>{banner}</>;

  const created = (id: string) => {
    setCreating(false);
    setSelected(id);
    // Spec §5: a new character starts where its first key goes.
    setInitialTab('stt');
    void refresh();
  };

  if (list.length === 0 && !creating) {
    return (
      <>
        {banner}
        <main className="empty">
          <button type="button" className="first" onClick={() => setCreating(true)}>{t('firstCharacter')}</button>
        </main>
      </>
    );
  }

  const current = list.find((c) => c.id === selected) ?? null;
  return (
    <>
      {banner}
      <div className="layout">
        <CharacterList
          list={list}
          selected={selected}
          onSelect={(id) => { setCreating(false); setSelected(id); setInitialTab('basic'); }}
          onNew={() => setCreating(true)}
        />
        <main className="pane">
          {creating ? (
            <NewCharacter
              onCreated={(d) => created(d.id)}
              onCancel={list.length > 0 ? () => setCreating(false) : undefined}
            />
          ) : current ? (
            renderEditor({
              id: current.id,
              online: current.online,
              initialTab,
              onChanged: () => void refresh(),
              onDeleted: () => { setSelected(null); void refresh(); },
            })
          ) : null}
        </main>
      </div>
    </>
  );
}
