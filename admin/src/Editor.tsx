import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { deepMerge } from './merge';
import { useAutoSave } from './useAutoSave';
import { BasicTab } from './BasicTab';
import { LayerTab } from './LayerTab';
import { ReflexTab } from './ReflexTab';
import { Dot } from './CharacterList';
import { runCheck, runTry, type CheckFn, type TryFn } from './checks';
import { t, type Key } from './i18n';
import type { Detail, EditorSlot, Patch, TabName } from './types';

const TABS: Array<[TabName, Key]> = [
  ['basic', 'tabBasic'], ['stt', 'tabStt'], ['llm', 'tabLlm'], ['tts', 'tabTts'], ['reflex', 'tabReflex'],
];

export function Editor(props: EditorSlot & { check?: CheckFn; tryReflex?: TryFn }) {
  const { id, online, onChanged } = props;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<TabName>(props.initialTab);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get(id).then((d) => live && setDetail(d), (err: Error) => live && setLoadError(err.message));
    return () => { live = false; };
  }, [id]);

  // The server's copy is not put back into the form: it would undo whatever
  // was typed while the save was in flight. Only the list needs to hear.
  const onSaved = useCallback(() => onChanged(), [onChanged]);
  const save = useAutoSave(id, onSaved);

  if (loadError) return <p role="alert" className="error">{loadError}</p>;
  if (!detail) return null;

  const update = (p: Patch) => {
    setDetail((d) => (d ? { ...d, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.endpoints ? { endpoints: p.endpoints } : {}), config: deepMerge(d.config, p.config) } : d));
    save.queue(p);
  };

  return (
    <section className="editor">
      <header>
        <h2>{detail.name}</h2>
        <Dot online={online} />
        <button
          type="button"
          className="danger remove"
          onClick={async () => {
            if (!window.confirm(t('confirmRemove'))) return;
            try {
              await api.remove(id);
              props.onDeleted();
            } catch (err) {
              setLoadError((err as Error).message);
            }
          }}
        >
          {t('remove')}
        </button>
      </header>
      <div role="tablist" className="tabs">
        {TABS.map(([name, label]) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{t(label)}</button>
        ))}
      </div>
      <div role="tabpanel" className="panel">
        {save.error && <p role="alert" className="error">{t('saveFailed')}{save.error}</p>}
        {tab === 'basic'
          ? <BasicTab detail={detail} update={update} onToken={(token) => setDetail((d) => (d ? { ...d, token } : d))} />
          : <LayerTab key={tab} id={id} layer={tab} config={detail.config} endpoints={detail.endpoints} update={update} check={props.check ?? runCheck} />}
        {tab === 'reflex' && <ReflexTab config={detail.config} update={update} tryIt={props.tryReflex ?? runTry} />}
      </div>
    </section>
  );
}
