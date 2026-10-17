import { t } from './i18n';
import type { Detail, Motion, Patch } from './types';

export function BasicTab({ detail, update }: { detail: Detail; update(p: Patch): void }) {
  const c = detail.config;
  return (
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
        </select>
        <small>{t('motionHint')}</small>
      </label>
      <label className="check">
        <input type="checkbox" checked={c.wakeWord} onChange={(e) => update({ config: { wakeWord: e.target.checked } })} />
        {t('wakeWord')}
      </label>
    </div>
  );
}
