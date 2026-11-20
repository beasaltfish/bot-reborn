import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TEMPLATES } from '../../core/bodies.js';
import { ActionsEditor } from './ActionsEditor';
import { t } from './i18n';
import type { BodyAction, Detail } from './types';

const detail = (id: 'toy' | 'pet' | 'tarot' | 'none' = 'tarot'): Detail => ({
  id: 'A', name: 'A', token: 'ab'.repeat(16), config: {
    stt: { baseURL: '', apiKey: '', model: '', prompt: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    reflex: { baseURL: '', apiKey: '', model: '', enabled: true, threshold: 0.8, state: '', question: null },
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false,
    body: { id }, persona: '',
  }, endpoints: [], savedReflexes: [], online: false,
});

const box = () => screen.getByLabelText(t('actionsTitle')) as HTMLTextAreaElement;

/** A pet action of the person's own, named by a hand-written trigger. */
const waveAction = () => ({
  ...TEMPLATES.pet.actions[0],
  name: 'wave',
  label: { en: 'Wave', zh: '挥爪' },
  say: 'Wave a paw.',
}) as BodyAction;

/** Open the collapsed section so its controls are real click targets. */
const open = async () => {
  await userEvent.click(screen.getByText(new RegExp(`^${t('actionsTitle')}`), { selector: 'summary' }));
};

describe('ActionsEditor', () => {
  it('shows the template\'s actions as JSON, and says they are inherited', () => {
    render(<ActionsEditor detail={detail('tarot')} update={vi.fn()} />);
    expect(JSON.parse(box().value)).toEqual(TEMPLATES.tarot.actions);
    expect(screen.getByText(/these are the template/i)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(t('presetCustom')))).toBeNull();
  });

  it('refuses JSON that does not fit the body, and names the line', async () => {
    const update = vi.fn();
    render(<ActionsEditor detail={detail('pet')} update={update} />);
    await open();
    const pose = TEMPLATES.pet.actions[0];
    fireEvent.change(box(), { target: { value: JSON.stringify([pose, pose], null, 2) } });
    // The sentence `bodyProblem` writes, not a stack and not the parser's.
    expect(screen.getByRole('alert')).toHaveTextContent('pet: two actions are called pose');
    expect(update).not.toHaveBeenCalled();
  });

  it('says a malformed JSON document is not saved', async () => {
    const update = vi.fn();
    render(<ActionsEditor detail={detail('pet')} update={update} />);
    await open();
    fireEvent.change(box(), { target: { value: '{ not json' } });
    expect(screen.getByRole('alert')).toHaveTextContent(t('jsonInvalid'));
    expect(update).not.toHaveBeenCalled();
  });

  it('a copy stops inheriting: the card says "custom"', async () => {
    const update = vi.fn();
    const d = detail('tarot');
    const { rerender } = render(<ActionsEditor detail={d} update={update} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: t('actionsCopy') }));
    expect(update).toHaveBeenCalledWith({ config: { body: { actions: TEMPLATES.tarot.actions } } });

    // What `Editor` does with the patch: the page now carries its own actions.
    rerender(<ActionsEditor
      detail={{ ...d, config: { ...d.config, body: { id: 'tarot', actions: TEMPLATES.tarot.actions as BodyAction[] } } }}
      update={update}
    />);
    expect(screen.getByText(new RegExp(t('presetCustom')))).toBeInTheDocument();
  });

  it('clearing triggers writes an explicit empty list, and keeps the valid edit', async () => {
    const update = vi.fn();
    render(<ActionsEditor detail={detail('tarot')} update={update} />);
    await open();
    fireEvent.change(box(), { target: { value: JSON.stringify(TEMPLATES.pet.actions, null, 2) } });
    // The inherited shake no longer names an action the body has; strict
    // resolution is what says so instead of dropping it behind the person.
    expect(screen.getByRole('alert')).toHaveTextContent(/shake trigger names draw_card/);
    expect(update).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: t('actionsClearTriggers') }));
    // `[]`, not an absent key: absent would inherit the template's shake again.
    expect(update).toHaveBeenCalledWith({
      config: { body: { triggers: [], actions: TEMPLATES.pet.actions } },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a step that is not a step instead of throwing', async () => {
    const update = vi.fn();
    render(<ActionsEditor detail={detail('pet')} update={update} />);
    await open();
    const broken = [{ ...TEMPLATES.pet.actions[0], run: [null] }] as unknown as BodyAction[];
    fireEvent.change(box(), { target: { value: JSON.stringify(broken, null, 2) } });
    expect(screen.getByRole('alert')).toHaveTextContent(/run\[0\] of pose is not a step/);
    expect(update).not.toHaveBeenCalled();
  });

  it('validates a trigger resolveBody would have dropped', async () => {
    const update = vi.fn();
    const d = detail('pet');
    // `button -> wave` names an action that is not written yet. `resolveBody`
    // filters it out; the editor must not read that filter as approval.
    d.config.body.triggers = [{ on: 'button', action: 'wave' }];
    render(<ActionsEditor detail={d} update={update} />);
    await open();
    fireEvent.change(box(), { target: { value: `${JSON.stringify(TEMPLATES.pet.actions, null, 2)}\n` } });
    expect(screen.getByRole('alert')).toHaveTextContent(/button trigger names wave/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses "use the template" when it would strand a trigger', async () => {
    const update = vi.fn();
    const d = detail('pet');
    d.config.body = {
      id: 'pet',
      actions: [...TEMPLATES.pet.actions, waveAction()],
      triggers: [{ on: 'button', action: 'wave' }],
    };
    render(<ActionsEditor detail={d} update={update} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: t('actionsUse') }));
    expect(screen.getByRole('alert')).toHaveTextContent(/button trigger names wave/);
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps "use the template" intent when the trigger is cleared next', async () => {
    const update = vi.fn();
    const d = detail('pet');
    d.config.body = {
      id: 'pet',
      actions: [...TEMPLATES.pet.actions, waveAction()],
      triggers: [{ on: 'button', action: 'wave' }],
    };
    render(<ActionsEditor detail={d} update={update} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: t('actionsUse') }));
    expect(update).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: t('actionsClearTriggers') }));
    // `null`, not the template's actions: the box looked restored, so the
    // body must inherit again rather than become a copy of what it followed.
    expect(update).toHaveBeenCalledWith({ config: { body: { triggers: [], actions: null } } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers "clear triggers" for a trigger the resolved body dropped', async () => {
    const d = detail('pet');
    // `resolveBody` filters this out, so the resolved body has none — but the
    // trigger is what refuses every edit, and clearing it is the way out.
    d.config.body.triggers = [{ on: 'button', action: 'wave' }];
    render(<ActionsEditor detail={d} update={vi.fn()} />);
    await open();
    expect(screen.getByRole('button', { name: t('actionsClearTriggers') })).toBeInTheDocument();
  });

  it('clearing triggers on an unedited template writes only the trigger list', async () => {
    const update = vi.fn();
    render(<ActionsEditor detail={detail('tarot')} update={update} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: t('actionsClearTriggers') }));
    // No actions copy: an unedited tarot must keep following its template.
    expect(update).toHaveBeenCalledWith({ config: { body: { triggers: [] } } });
  });

  it('using the template removes the override again', async () => {
    const update = vi.fn();
    const own = { id: 'tarot' as const, actions: TEMPLATES.pet.actions as BodyAction[] };
    const d = detail('tarot');
    const { rerender } = render(<ActionsEditor
      detail={{ ...d, config: { ...d.config, body: own } }} update={update}
    />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: t('actionsUse') }));
    // `null`, not an absent key: the server merges, so an absent property
    // would leave the copy on disk.
    expect(update).toHaveBeenCalledWith({ config: { body: { actions: null } } });

    rerender(<ActionsEditor detail={d} update={update} />);
    expect(screen.queryByText(new RegExp(t('presetCustom')))).toBeNull();
    expect(JSON.parse(box().value)).toEqual(TEMPLATES.tarot.actions);
  });
});
