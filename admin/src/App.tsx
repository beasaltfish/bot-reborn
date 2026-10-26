import { useState, type ReactNode } from 'react';
import { Brand } from './Brand';
import { CharacterList } from './CharacterList';
import { NewCharacter } from './NewCharacter';
import { useCharacters } from './useCharacters';
import { t } from './i18n';
import type { EditorSlot, TabName } from './types';

// The character open last, per browser: the page opens on it rather than on
// an empty pane. Storage can be missing or refuse (private windows), and then
// the page simply opens on the first character.
const REMEMBER = 'admin.character';
function remembered(): string | null {
  try { return localStorage.getItem(REMEMBER); } catch { return null; }
}
function remember(id: string) {
  try { localStorage.setItem(REMEMBER, id); } catch { /* nothing to keep it in */ }
}

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
    remember(id);
    // Spec §5: a new character starts where its first key goes.
    setInitialTab('stt');
    void refresh();
  };

  if (list.length === 0 && !creating) {
    return (
      <>
        {banner}
        <main className="empty">
          <div className="welcome">
            <Brand big />
            <p className="tagline">{t('tagline')}</p>
            <button type="button" className="first" onClick={() => setCreating(true)}>{t('firstCharacter')}</button>
          </div>
        </main>
      </>
    );
  }

  // Nothing picked yet, or the pick was deleted: the one open last time,
  // else the first.
  const current = list.find((c) => c.id === selected)
    ?? list.find((c) => c.id === remembered())
    ?? list[0] ?? null;
  return (
    <>
      {banner}
      <div className="layout">
        <CharacterList
          list={list}
          selected={creating ? null : current?.id ?? null}
          onSelect={(id) => { setCreating(false); setSelected(id); remember(id); setInitialTab('basic'); }}
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
