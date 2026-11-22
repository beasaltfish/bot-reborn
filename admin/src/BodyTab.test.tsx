import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TEMPLATES, registerPlugins } from '../../core/bodies.js';
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

/** The brain's answers, by path; anything unlisted is a miss, as on a brain
 * that predates the endpoint. */
const fetchMock = (routes: Record<string, unknown>) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
  const path = String(input);
  if (!(path in routes)) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => routes[path] };
}));

/** One plugin as `/api/bodies` sends it: enough to build the body again. */
const SERVO = {
  id: 'my-servo',
  label: { en: 'Servo', zh: '舵机' },
  commands: [{ name: 'point', run: [{ op: 'pin.write', args: { pin: 'sig', value: 1 } }], timeoutMs: 100 }],
  resources: [{ kind: 'gpio', name: 'sig', gpio: 5, direction: 'output', safe: 0 }],
};

/** A character that already follows the plugin: the card must come up checked.
 * `template` holds a plugin id there, exactly as the page writes it. */
const servoDetail = (): Detail => {
  const d = detail();
  d.config.body = { id: 'my-servo', template: 'my-servo' };
  return d;
};

afterEach(() => {
  vi.unstubAllGlobals();
  // The registry is process-wide and BodyTab fills it from the brain: the next
  // test starts from an empty one, as a page with no plugins would.
  registerPlugins({});
});

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

  it('keeps a body of one’s own when switching template', async () => {
    const update = vi.fn();
    const d = detail();
    d.config.body = { id: 'my-dog', template: 'pet' };
    render(<BodyTab detail={d} update={update} />);
    await userEvent.click(screen.getByRole('radio', { name: /^voice only/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { template: 'none' } } });
  });

  it('does not mistake a property name for a template when keeping a body of one’s own', async () => {
    const update = vi.fn();
    const d = detail();
    // `TEMPLATES.constructor` is a function: a property read would call this a
    // template id and overwrite it.
    d.config.body = { id: 'constructor', template: 'pet' };
    render(<BodyTab detail={d} update={update} />);
    await userEvent.click(screen.getByRole('radio', { name: /^voice only/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { template: 'none' } } });
  });

  it('a config with no template resolves like the brain: voice only, not a missing body', () => {
    const d = detail();
    d.config.body = { id: 'my-bot' };
    renderTab(d);
    expect(screen.getByRole('radio', { name: /^voice only/i })).toBeChecked();
  });

  it('draws the fallback rather than an Object property for a body named after one', () => {
    const d = detail();
    d.config.body = { id: 'constructor' };
    render(<BodyTab detail={d} update={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Voice only' })).toBeInTheDocument();
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

  it('lists a plugin body from the brain beside the built-in cards', async () => {
    fetchMock({ '/api/bodies': [SERVO] });
    renderTab(detail());
    expect(await screen.findByText('Servo')).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    const radio = screen.getByRole('radio', { name: /servo/i });
    const card = within(radio.closest('label') as HTMLElement);
    expect(card.getByText(/voice only/i)).toBeVisible();
    expect(card.getByText(/point/)).toBeVisible();
  });

  it('picking a plugin body writes its id and the template it follows', async () => {
    fetchMock({ '/api/bodies': [SERVO] });
    const update = vi.fn();
    renderTab(detail('none'), update);
    await userEvent.click(await screen.findByRole('radio', { name: /servo/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { id: 'my-servo', template: 'my-servo' } } });
  });

  it('marks the plugin body checked when the config already follows it', async () => {
    fetchMock({ '/api/bodies': [SERVO] });
    renderTab(servoDetail());
    // The page must register the plugin before resolving: an empty registry
    // sends `my-servo` back to `none`, and the wrong radio wins.
    expect(await screen.findByRole('radio', { name: /servo/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^voice only/i })).not.toBeChecked();
  });

  it('accepts an action that calls a plugin command, and refuses one that does not', async () => {
    fetchMock({ '/api/bodies': [SERVO] });
    const update = vi.fn();
    renderTab(servoDetail(), update);
    await screen.findByRole('radio', { name: /servo/i });
    const action = (command: string) => [{
      name: 'point_at', label: { en: 'Point', zh: '指' }, say: 'Point at something.', run: [{ command }],
    }];
    const box = screen.getByLabelText('Actions') as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: JSON.stringify(action('point'), null, 2) } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(update).toHaveBeenCalledWith({ config: { body: { actions: action('point') } } });

    fireEvent.change(box, { target: { value: JSON.stringify(action('nope'), null, 2) } });
    expect(screen.getByRole('alert')).toHaveTextContent(/unknown command "nope"/);
  });

  it('leaves the built-in cards exactly as they are when the plugin list fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    renderTab(detail());
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.queryByText('Servo')).toBeNull();
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
