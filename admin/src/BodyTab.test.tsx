import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TEMPLATES, pluginBodies, registerPlugins } from '../../core/bodies.js';
import { BodyTab } from './BodyTab';
import { installFakeApi } from './test/fakeApi';
import type { BodyAction, Detail, Patch } from './types';

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
  commands: [{ name: 'point', run: [{ op: 'pin.write', args: { pin: 'sig', level: 1 } }], timeoutMs: 100 }],
  resources: [{ kind: 'gpio', name: 'sig', gpio: 5, direction: 'output', safe: 0 }],
};

/** A character that already follows the plugin: the card must come up checked.
 * `template` holds a plugin id there, exactly as the page writes it. */
const servoDetail = (): Detail => {
  const d = detail();
  d.config.body = { id: 'my-servo', template: 'my-servo' };
  return d;
};

/** One module as `/api/modules` lists it, with the body the install answers. */
const LED = {
  id: 'led-module',
  label: { en: 'LED module', zh: 'LED 模块' },
  parts: ['esp32', 'led-5mm', 'resistor'],
  note: { en: 'Works on the bench and on the board.', zh: '模拟器与真板都可用。' },
  examples: [
    { name: 'light_up', label: { en: 'Light up', zh: '点亮' }, say: 'Turn the desk LED on.', run: [{ command: 'led_on' }] },
    { name: 'light_down', label: { en: 'Light down', zh: '熄灭' }, say: 'Turn the desk LED off.', run: [{ command: 'led_off' }] },
  ],
  commands: ['led_on', 'led_off'],
};

/** `/api/bodies`' answer once the module's body exists in the brain. */
const LED_BODY = {
  id: 'led-module',
  label: LED.label,
  commands: [
    { name: 'led_on', run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }], timeoutMs: 500 },
    { name: 'led_off', run: [{ op: 'pin.write', args: { pin: 'led', level: 0 } }], timeoutMs: 500 },
  ],
  resources: [{ kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 }],
};

/**
 * A brain that lists one module, installs it, and only then lists its body —
 * with the call log, so the order the page asks in can be checked. The board
 * does not exist before the install, as in a brain that just started.
 */
const moduleFetch = ({ installError, refreshFails = false, examples, rows, initiallyInstalled = false }: {
  installError?: string;
  /** The install wrote the body, but `/api/bodies` cannot be read back. */
  refreshFails?: boolean;
  /** The examples the install answers with, when not the module's own. */
  examples?: unknown;
  /** The `/api/modules` rows, when the test is about a malformed catalogue. */
  rows?: unknown[];
  /** A brain where the body was installed before this page was opened. */
  initiallyInstalled?: boolean;
} = {}) => {
  const calls: string[] = [];
  let installed = initiallyInstalled;
  const answer = (ok: boolean, body: unknown) => ({ ok, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (path === '/api/modules') return answer(true, rows ?? [{ ...LED, installed }]);
    if (path === '/api/modules/led-module/install') {
      if (installError) return answer(false, { error: installError });
      installed = true;
      return answer(true, { body: LED_BODY, examples: examples ?? LED.examples });
    }
    if (path === '/api/bodies') {
      if (!installed) return answer(true, []);
      return refreshFails ? answer(false, {}) : answer(true, [LED_BODY]);
    }
    return answer(false, {});
  }));
  return calls;
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

  it('clears the browser plugin registry when the brain lists none', async () => {
    // The registry is process-wide: a page that already found a plugin (or a
    // previous test) holds one body, and an empty answer must replace it rather
    // than merge into it. Without this the `my-servo` card outlives the plugin.
    registerPlugins({ 'my-servo': { ...structuredClone(TEMPLATES.none), id: 'my-servo', label: { en: 'Servo', zh: '舵机' } } });
    fetchMock({ '/api/bodies': [] });
    renderTab(detail());
    await vi.waitFor(() => expect(pluginBodies()).toEqual({}));
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('offers the chosen body\'s actions under the cards, as the template has them', () => {
    renderTab(detail('tarot'));
    const box = screen.getByLabelText('Actions') as HTMLTextAreaElement;
    expect(JSON.parse(box.value)).toEqual(TEMPLATES.tarot.actions);
    expect(screen.getByText(/these are the template/i)).toBeInTheDocument();
  });

  it('tells a plugin body it is simulator-only, not that it can be flashed', async () => {
    // The body firmware has no command channel: reusing the board line here
    // promised a flash that would produce a body which cannot answer a `cmd`.
    fetchMock({ '/api/bodies': [SERVO] });
    renderTab(servoDetail());
    await screen.findByRole('radio', { name: /servo/i });

    expect(screen.getByText(/simulator only — no board firmware/i)).toBeInTheDocument();
    expect(screen.getByText(/wiring the pins it names/i)).toBeInTheDocument();
    expect(screen.queryByText(/flash it once from set up a board/i)).toBeNull();
  });

  it('a body with no art is still drawn, without a broken picture in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ pet: [], tarot: [] }) })));
    renderTab(detail('tarot'));
    expect(await screen.findByRole('img', { name: 'Tarot reader' })).toBeInTheDocument();
    expect(screen.getByTestId('body-preview').querySelector('image')).toBeNull();
    expect(screen.getByTestId('body-preview').querySelector('[data-part="screen"]')).not.toBeNull();
  });

  it('lists the modules with what they are made of and how many actions they bring', async () => {
    moduleFetch();
    renderTab(detail());
    const name = await screen.findByText('LED module');
    const card = within(name.closest('.module-card') as HTMLElement);
    expect(card.getByText(/led-5mm/)).toBeVisible();
    expect(card.getByText(/2 example actions/i)).toBeVisible();
    expect(card.getByText(/2 commands/i)).toBeVisible();
    expect(card.getByText(/works on the bench/i)).toBeVisible();
    expect(card.getByRole('button', { name: /add to this character/i })).toBeVisible();
  });

  it('installs, refreshes the body list, then adopts with the confirmed examples', async () => {
    const calls = moduleFetch();
    // Registration must already have happened when the PATCH is handed over:
    // this assertion runs inside the mock, at write time.
    const update = vi.fn((_patch: Patch) => {
      expect(pluginBodies()).toHaveProperty('led-module');
    });
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    await userEvent.click(screen.getByRole('button', { name: /add 2 example actions/i }));
    const patch = update.mock.calls[0][0] as Patch;
    expect(patch.config?.body).toEqual(expect.objectContaining({ template: 'led-module' }));
    // The confirmed examples are the point of the step, not just the template.
    expect(patch.config?.body?.actions?.map((action) => action.name)).toEqual(['light_up', 'light_down']);
    const installed = calls.indexOf('POST /api/modules/led-module/install');
    const refresh = calls.indexOf('GET /api/bodies', installed + 1);
    expect(installed).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(installed);
  });

  it('adopting keeps the actions the module can run and says what it left behind', async () => {
    moduleFetch();
    const d = detail('toy');
    d.config.body.actions = structuredClone(TEMPLATES.toy.actions) as BodyAction[];
    // Stored triggers are raw: the one naming a dropped action must not reach
    // the next read of the actions editor.
    d.config.body.triggers = [
      { on: 'shake', action: 'move' },
      { on: 'button', action: 'play_sound' },
    ];
    const update = vi.fn();
    renderTab(d, update);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    await userEvent.click(screen.getByRole('button', { name: /add 2 example actions/i }));
    const patch = update.mock.calls[0][0] as Patch;
    // The toy drives; a voice-only module body does not. A sound needs only the
    // voice, so it is carried over with the module's own examples.
    expect(patch.config?.body?.actions?.map((action) => action.name))
      .toEqual(['play_sound', 'light_up', 'light_down']);
    expect(patch.config?.body?.triggers).toEqual([{ on: 'button', action: 'play_sound' }]);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/cannot run these actions/i);
    expect(status).toHaveTextContent(/move, cruise, stop/);
  });

  it('does not write an adoption the module body still refuses, and says why', async () => {
    // An example that takes the tool-writing action's name: the merged body is
    // refused, so nothing may be written — the sentence is the whole result.
    moduleFetch({ examples: [{ name: 'set_reply_language', label: { en: 'x', zh: 'x' }, say: 'x', run: [] }] });
    const update = vi.fn();
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    await userEvent.click(screen.getByRole('button', { name: /add 1 example action/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/set_reply_language is the tool that writes config/i);
    expect(update).not.toHaveBeenCalled();
  });

  it('marks the module installed and keeps a per-character entry', async () => {
    moduleFetch();
    renderTab(detail());
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    const section = (await screen.findByRole('heading', { name: 'Modules' })).closest('section') as HTMLElement;
    const card = within(section).getAllByText('LED module')[0].closest('.module-card') as HTMLElement;
    expect(within(card).getByText(/installed/i)).toBeVisible();
    expect(within(card).queryByRole('button', { name: /add to this character/i })).toBeNull();
    // Installed is body-level; the examples are still this character's choice.
    expect(within(card).getByRole('button', { name: /add its examples/i })).toBeVisible();
    expect(within(card).getByRole('button', { name: /reinstall/i })).toBeVisible();
    expect(card).toHaveTextContent(/connected body must pair again/i);
  });

  it('offers the examples to a second character whose page has no entry yet', async () => {
    // The body is on the brain; this page just opened and its plugin registry
    // is empty. Clicking adds the examples without a second install.
    const calls = moduleFetch({ initiallyInstalled: true });
    const update = vi.fn();
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add its examples/i }));
    await userEvent.click(screen.getByRole('button', { name: /add 2 example actions/i }));
    expect(calls).toContain('GET /api/bodies');
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
    const patch = update.mock.calls[0][0] as Patch;
    expect(patch.config?.body?.template).toBe('led-module');
    expect(patch.config?.body?.actions?.map((action) => action.name)).toEqual(['light_up', 'light_down']);
  });

  it('still offers the examples after a cancel and a reload', async () => {
    moduleFetch();
    const first = render(<BodyTab detail={detail()} update={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    first.unmount();
    // A fresh page starts with the body installed and no registry entry of its
    // own: the per-character entry must still be there.
    registerPlugins({});
    const update = vi.fn();
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add its examples/i }));
    await userEvent.click(screen.getByRole('button', { name: /add 2 example actions/i }));
    const patch = update.mock.calls[0][0] as Patch;
    expect(patch.config?.body?.actions?.map((action) => action.name))
      .toEqual(['light_up', 'light_down']);
  });

  it('still switches the body when the examples are turned down', async () => {
    moduleFetch();
    const update = vi.fn();
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(update).toHaveBeenCalledWith({
      config: { body: { id: 'led-module', template: 'led-module', actions: [] } },
    });
  });

  it('shows why an install failed, and writes nothing', async () => {
    moduleFetch({ installError: 'led-module was refused by the plugin loader' });
    const update = vi.fn();
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/refused by the plugin loader/);
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /example actions/i })).toBeNull();
  });

  it('says the body is installed but this page could not reload it', async () => {
    // The brain wrote the body but `/api/bodies` failed. It is installed, so
    // "could not install" would be false; the entry stays so a reload can finish
    // the adoption.
    moduleFetch({ refreshFails: true });
    const update = vi.fn();
    renderTab(detail(), update);
    await userEvent.click(await screen.findByRole('button', { name: /add to this character/i }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent(/installed, but this page could not reload it/i);
    expect(screen.queryByRole('button', { name: /example actions/i })).toBeNull();
    const section = (await screen.findByRole('heading', { name: 'Modules' })).closest('section') as HTMLElement;
    const card = within(section).getAllByText('LED module')[0].closest('.module-card') as HTMLElement;
    expect(within(card).getByText(/^installed$/i)).toBeVisible();
    expect(within(card).getByRole('button', { name: /add its examples/i })).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });

  it('skips a module row whose examples are not a list', async () => {
    moduleFetch({ rows: [{ ...LED, examples: undefined }] });
    renderTab(detail());
    // The panel is empty, so the page keeps exactly the body cards it had.
    await vi.waitFor(() => expect(pluginBodies()).toEqual({}));
    expect(screen.queryByText('LED module')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Modules' })).toBeNull();
  });
});
