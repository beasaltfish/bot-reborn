// Body and Reflex are real work, but not the first thing anyone does. They sit
// behind Advanced in Basic, in the order the brain reads them: what the body
// can do, whether the reflex runs, its provider, then its question.
import { BodyTab } from './BodyTab';
import { LayerTab } from './LayerTab';
import { ReflexSwitch, ReflexTab } from './ReflexTab';
import type { CheckFn, TryFn } from './checks';
import type { Detail, Patch } from './types';

export function AdvancedPanels({ id, detail, update, check, tryReflex }: {
  id: string; detail: Detail; update(p: Patch): void; check: CheckFn; tryReflex: TryFn;
}) {
  return (
    <>
      <BodyTab detail={detail} update={update} />
      <ReflexSwitch reflex={detail.config.reflex} update={update} />
      <LayerTab id={id} layer="reflex" config={detail.config} endpoints={detail.endpoints} update={update} check={check} />
      <ReflexTab config={detail.config} saved={detail.savedReflexes ?? []} update={update} tryIt={tryReflex} />
    </>
  );
}
