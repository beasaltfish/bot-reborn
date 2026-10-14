import { t } from './i18n';
import type { Summary } from './types';

export function Dot({ online }: { online: boolean }) {
  return <span className={online ? 'dot on' : 'dot'}>{online ? t('online') : t('offline')}</span>;
}

export function CharacterList(props: {
  list: Summary[];
  selected: string | null;
  onSelect(id: string): void;
  onNew(): void;
}) {
  return (
    <nav className="list">
      <h1>{t('characters')}</h1>
      {props.list.map((c) => (
        <button
          key={c.id}
          type="button"
          className={c.id === props.selected ? 'item selected' : 'item'}
          onClick={() => props.onSelect(c.id)}
        >
          <span className="item-name">{c.name}</span>
          <Dot online={c.online} />
          <span className={c.ready ? 'badge ok' : 'badge'}>{c.ready ? t('ready') : t('missingKeys')}</span>
        </button>
      ))}
      <button type="button" className="new" onClick={props.onNew}>{t('newCharacter')}</button>
    </nav>
  );
}
