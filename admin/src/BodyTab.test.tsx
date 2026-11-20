import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TEMPLATES } from '../../core/bodies.js';
import { BodyTab } from './BodyTab';
import { installFakeApi } from './test/fakeApi';
import type { BodyAction, Detail } from './types';

const detail = (id: 'toy' | 'pet' | 'tarot' | 'dry-run' | 'none' = 'pet'): Detail => ({
  id: 'A', name: 'A', token: 'ab'.repeat(16), config: {
    stt: { baseURL: '', apiKey: '', model: '', prompt: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    reflex: { baseURL: '', apiKey: '', model: '', enabled: true, threshold: 0.8, state: '', question: null },
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false,
    body: { id }, persona: '',
  }, endpoints: [], savedReflexes: [], online: false,
});

const renderTab = (d = detail(), update = vi.fn()) => render(<BodyTab detail={d} update={update} />);

afterEach(() => { vi.unstubAllGlobals(); });

describe('BodyTab', () => {
  it('shows a card per body with what it needs and what it does', () => {
    renderTab(detail());
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    const pet = screen.getByRole('radio', { name: /pet on a screen/i });
    expect(pet).toBeChecked();
    const card = within(pet.closest('label') as HTMLElement);
    expect(card.getByText(/hears you · speaks · shows/)).toBeVisible();
  });

  it('keeps the bench-only dry run out of the picker unless it is asked for', () => {
    renderTab(detail('toy'));
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByRole('radio', { name: /dry run/i })).toBeNull();
  });

  it('shows the dry run for a bench run', () => {
    window.history.replaceState({}, '', '/?bench');
    try {
      renderTab(detail('toy'));
      expect(screen.getAllByRole('radio')).toHaveLength(5);
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('never hides the body that is already chosen', () => {
    renderTab(detail('dry-run'));
    expect(screen.getByRole('radio', { name: /dry run/i })).toBeChecked();
  });

  it('never spends a line on what a body cannot do', () => {
    renderTab(detail());
    expect(screen.queryByText(/cannot/i)).toBeNull();
  });

  it('says the body is a set of capabilities, not a firmware', () => {
    renderTab(detail());
    expect(screen.getByText(/not the firmware/i)).toBeInTheDocument();
  });

  it('a voice-only body is a board with ears and a voice, and nothing else', () => {
    renderTab(detail('none'));
    const voice = screen.getByRole('radio', { name: /voice only/i });
    expect(voice).toBeChecked();
    const card = within(voice.closest('label') as HTMLElement);
    expect(card.getByText(/ESP32-S3 board · microphone · speaker amp/)).toBeVisible();
  });

  it('a body that runs on a board says so, once', () => {
    renderTab(detail('toy'));
    expect(screen.getByText(/flash it once/i)).toBeInTheDocument();
    expect(screen.getAllByText(/flash it once/i)).toHaveLength(1);
  });

  it('does not offer the phone body yet', () => {
    installFakeApi();
    renderTab(detail('toy'));
    expect(screen.queryByText(/\/phone\/#token=/)).toBeNull();
    expect(screen.queryByText(/scan the QR code/i)).toBeNull();
  });

  it('picking a body writes its id and the template it follows', async () => {
    const update = vi.fn();
    renderTab(detail('none'), update);
    await userEvent.click(screen.getByRole('radio', { name: /toy on wheels/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { id: 'toy', template: 'toy' } } });
  });

  it('keeps actions the body switched to can still run', async () => {
    const update = vi.fn();
    const d = detail('none');
    d.config.body.actions = structuredClone(TEMPLATES.none.actions) as BodyAction[];
    renderTab(d, update);
    // `play_sound` needs only the voice, which the pet has too.
    await userEvent.click(screen.getByRole('radio', { name: /pet on a screen/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { id: 'pet', template: 'pet' } } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears a copied pose when switching to a voice-only body, and says so', async () => {
    const update = vi.fn();
    const d = detail('pet');
    d.config.body.actions = structuredClone(TEMPLATES.pet.actions) as BodyAction[];
    renderTab(d, update);
    // The pose needs a screen the voice-only body does not have: saving the
    // merge would leave a body `bodyProblem` refuses.
    await userEvent.click(screen.getByRole('radio', { name: /voice only/i }));
    expect(update).toHaveBeenCalledWith({
      config: { body: { id: 'none', template: 'none', actions: null, triggers: null } },
    });
    expect(screen.getByRole('status')).toHaveTextContent(/cannot run the actions or triggers/i);
    expect(screen.getByRole('status')).toHaveTextContent(/needs show/);
  });

  it('does not write a switch whose retained prompts are still broken', async () => {
    const update = vi.fn();
    const d = detail('pet');
    d.config.body.actions = structuredClone(TEMPLATES.pet.actions) as BodyAction[];
    // The prompt override is the person's words: a switch never drops it, so
    // clearing the actions would leave the body just as broken — and take the
    // unsaved-by-hand actions with it.
    d.config.body.prompts = { rules: 'one paragraph' as unknown as string[] };
    renderTab(d, update);
    await userEvent.click(screen.getByRole('radio', { name: /voice only/i }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/prompts\.rules is not a list of strings/i);
  });

  it('draws the chosen body with the frames the brain has, and says it is not a simulation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ pet: [], tarot: ['320x240/back.jpg'] }) })));
    renderTab(detail('tarot'));
    expect(await screen.findByRole('img', { name: 'Tarot reader' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId('body-preview').querySelector('image')?.getAttribute('href'))
      .toBe('/preview/tarot/320x240/back.jpg'));
    expect(screen.getByText(/not a simulation/i)).toBeInTheDocument();
  });

  it('offers the chosen body\'s actions under the cards, as the template has them', () => {
    renderTab(detail('tarot'));
    const box = screen.getByLabelText('Actions') as HTMLTextAreaElement;
    expect(JSON.parse(box.value)).toEqual(TEMPLATES.tarot.actions);
    expect(screen.getByText(/these are the template/i)).toBeInTheDocument();
  });

  it('a body with no art is still drawn, without a broken picture in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ pet: [], tarot: [] }) })));
    renderTab(detail('tarot'));
    expect(await screen.findByRole('img', { name: 'Tarot reader' })).toBeInTheDocument();
    expect(screen.getByTestId('body-preview').querySelector('image')).toBeNull();
    expect(screen.getByTestId('body-preview').querySelector('[data-part="screen"]')).not.toBeNull();
  });
});
