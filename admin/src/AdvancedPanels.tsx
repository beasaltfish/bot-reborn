// Reflex is real work, but not the first thing anyone does. It sits behind
// Advanced in Basic, in the order the brain reads it: whether the reflex runs,
// its provider, then its question. The body is not here: it has its own tab.
import { LayerTab } from './LayerTab';
import { ReflexSwitch, ReflexTab } from './ReflexTab';
import type { CheckFn, TryFn } from './checks';
import type { Detail, Patch } from './types';

export function AdvancedPanels({ id, detail, update, check, tryReflex }: {
  id: string; detail: Detail; update(p: Patch): void; check: CheckFn; tryReflex: TryFn;
}) {
  return (
    <>
      <ReflexSwitch reflex={detail.config.reflex} update={update} />
      <LayerTab id={id} layer="reflex" config={detail.config} endpoints={detail.endpoints} update={update} check={check} />
      <ReflexTab config={detail.config} saved={detail.savedReflexes ?? []} update={update} tryIt={tryReflex} />
    </>
  );
}
