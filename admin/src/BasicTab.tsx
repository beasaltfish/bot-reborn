import { DEFAULT_PERSONA, MAX_PERSONA } from '../../core/brain.js';
import { t } from './i18n';
import { PhoneLink } from './PhoneLink';
import { TokenBox } from './TokenBox';
import type { Detail, Motion, Patch } from './types';

// The phone is this character's body, so it is paired here with the body
// setting above, not on every tab.
export function BasicTab({ detail, update, onToken }: { detail: Detail; update(p: Patch): void; onToken(token: string): void }) {
  const c = detail.config;
  return (
    <>
      <div className="fields">
        <label>{t('name')}
          <input aria-label={t('name')} value={detail.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label>{t('replyLang')}
          <select
            aria-label={t('replyLang')}
            value={c.replyLang ?? 'auto'}
            onChange={(e) => update({ config: { replyLang: e.target.value === 'auto' ? null : (e.target.value as 'zh' | 'en') } })}
          >
            <option value="auto">{t('replyAuto')}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>{t('motion')}
          <select
            aria-label={t('motion')}
            value={c.body.motion}
            onChange={(e) => update({ config: { body: { motion: e.target.value as Motion } } })}
          >
            <option value="car">{t('motionCar')}</option>
            <option value="dry-run">{t('motionDryRun')}</option>
            <option value="none">{t('motionNone')}</option>
            <option value="pet">{t('motionPet')}</option>
          </select>
          <small>{t('motionHint')}</small>
        </label>
        <label>{t('persona')}
          <textarea
            aria-label={t('persona')} rows={6} maxLength={MAX_PERSONA} placeholder={DEFAULT_PERSONA}
            value={c.persona} onChange={(e) => update({ config: { persona: e.target.value } })}
          />
          <small>{t('personaHint')}</small>
        </label>
        {!c.persona.trim() && (
          <button type="button" className="secondary" onClick={() => update({ config: { persona: DEFAULT_PERSONA } })}>
            {t('personaFromDefault')}
          </button>
        )}
        <label className="check">
          <input type="checkbox" checked={c.wakeWord} onChange={(e) => update({ config: { wakeWord: e.target.checked } })} />
          {t('wakeWord')}
        </label>
        <label className="check">
          <input type="checkbox" checked={c.bargeIn} onChange={(e) => update({ config: { bargeIn: e.target.checked } })} />
          {t('bargeIn')}
          <small>{t('bargeInHint')}</small>
        </label>
      </div>
      <div className="pairing">
        <PhoneLink token={detail.token} />
        <TokenBox id={detail.id} onToken={onToken} />
      </div>
    </>
  );
}
