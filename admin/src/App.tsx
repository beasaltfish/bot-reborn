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

// The tabs a link may name: the provider layers plus the body. Reflex is not
// one, because it lives under Advanced.
const LINK_TABS: TabName[] = ['basic', 'stt', 'llm', 'tts', 'body'];

// A #character=<id> link (the simulator makes them) opens that character, and
// an optional &tab=<name> opens one of its tabs. It is read on load and
// whenever the address changes; an id nobody has is ignored, and the page
// opens as it would have. An unknown tab falls back to Basic.
function linked(): { id: string, tab?: TabName } | null {
  const m = location.hash.match(/^#character=([^&]+)(?:&tab=([a-z]+))?$/);
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return null; }
  const tab = m[2];
  return tab && (LINK_TABS as string[]).includes(tab) ? { id, tab: tab as TabName } : { id };
}

export function App({ pollMs = 2000, renderEditor }: {
  pollMs?: number;
  renderEditor: (props: EditorSlot) => ReactNode;
}) {
  const { list, down, refresh } = useCharacters(pollMs);
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string, tab?: TabName } | null>(linked);
  const [creating, setCreating] = useState(false);
  const [board, setBoard] = useState(false);
  const [initialTab, setInitialTab] = useState<TabName>(() => linked()?.tab ?? 'basic');
  useEffect(() => {
    const onHash = () => {
      const next = linked();
      setLink(next);
      setInitialTab(next?.tab ?? 'basic');
      setCreating(false);
      setBoard(false);
    };
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
  const current = list.find((c) => c.id === link?.id)
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
