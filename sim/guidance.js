// Views derived from a plan: today the next-step hint; later the overview too.
import { hanging, name } from './diagnose.js';
import { projectReason } from './ui/project-copy.js';
import { simText } from './ui/strings.js';
import { connectionProgress } from './project-progress.js';

/**
 * The first thing a person should do next for this plan.
 * @param {import('./bench.js').Bench} bench
 * @param {import('./plan.js').Plan|null} plan
 * @param {string} [lang]
 * @returns {{kind:string,text:string,points:string[]}|null}
 */
export function nextPlanHint(bench, plan, lang = 'en') {
  if (!plan) return null;
  // Recipe plans seat their parts; loose project parts would make every unused
  // pin look like a hanging warning, so only recipes use that check.
  if (plan.legacy?.recipeId) {
    const loose = hanging(bench, lang)[0];
    if (loose) return loose;
  }
  const row = connectionProgress(bench, plan).find(item => item.status === 'missing');
  if (!row) return null;
  if (!row.present) {
    return { kind: 'missing', text: simText(lang, 'hint.missingParts', { parts: row.missing.join(', ') }), points: [row.a, row.b] };
  }
  const link = plan.links.find(item => item.a === row.a && item.b === row.b);
  const why = link ? projectReason(lang, link.why) ?? link.why : '';
  const text = lang === 'zh'
    ? simText(lang, 'hint.next', { a: name(row.a), b: name(row.b), reason: why })
    : `Connect ${name(row.a)} to ${name(row.b)}. ${why}`;
  return { kind: 'missing', text, points: [row.a, row.b] };
}
