import { useEffect, useState, type ReactNode } from 'react';
import { Brand } from './Brand';
import { CharacterList } from './CharacterList';
import { BoardSetup } from './BoardSetup';
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

// A #character=<id> link (the simulator makes them) opens that character. It
// is read on load and whenever the address changes; an id nobody has is
// ignored, and the page opens as it would have.
function linked(): string | null {
  const m = location.hash.match(/^#character=(.+)$/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

export function App({ pollMs = 2000, renderEditor }: {
  pollMs?: number;
  renderEditor: (props: EditorSlot) => ReactNode;
}) {
  const { list, down, refresh } = useCharacters(pollMs);
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(linked);
  const [creating, setCreating] = useState(false);
  const [board, setBoard] = useState(false);
  const [initialTab, setInitialTab] = useState<TabName>('basic');
  useEffect(() => {
    const onHash = () => { setLink(linked()); setCreating(false); setBoard(false); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const banner = down ? <div className="banner" role="status">{t('serverDown')}</div> : null;
  if (list === null) return <>{banner}</>;

  const created = (id: string) => {
    setCreating(false);
    setSelected(id);
    setLink(null);
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

  // A link wins, then the pick; with neither (or one that is gone) the one
  // open last time, else the first.
  const current = list.find((c) => c.id === link)
    ?? list.find((c) => c.id === selected)
    ?? list.find((c) => c.id === remembered())
    ?? list[0] ?? null;
  return (
    <>
      {banner}
      <div className="layout">
        <CharacterList
          list={list}
          selected={creating || board ? null : current?.id ?? null}
          onSelect={(id) => { setBoard(false); setCreating(false); setSelected(id); setLink(null); remember(id); setInitialTab('basic'); }}
          onNew={() => { setBoard(false); setCreating(true); }}
          onBoard={() => { setCreating(false); setBoard(true); }}
        />
        <main className="pane">
          {board ? (
            <BoardSetup />
          ) : creating ? (
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
