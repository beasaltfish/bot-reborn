import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Editor } from './Editor';
import { installFakeApi } from './test/fakeApi';
import { REFLEX_PRESETS } from '../../core/reflex-presets.js';
import type { EditorSlot } from './types';

const props = (over: Partial<EditorSlot> = {}): EditorSlot =>
  ({ id: 'A', online: false, initialTab: 'basic', onChanged: vi.fn(), onDeleted: vi.fn(), ...over });

// A character whose layer already uses a preset, with its key still to type.
const GROQ = { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: '' };
const OPENAI = { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', apiKey: '' };
function withProvider(fake: ReturnType<typeof installFakeApi>, layer: 'llm' | 'tts', entry: typeof GROQ) {
  const c = fake.chars.get('A')!;
  c.endpoints = [entry];
  c.config[layer] = { ...c.config[layer], endpointId: entry.id, baseURL: entry.baseURL, model: 'm' };
}

describe('Editor', () => {
  it('saves only what changed, once, after typing stops', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    withProvider(fake, 'llm', GROQ);
    render(<Editor {...props({ initialTab: 'llm' })} />);
    const key = await screen.findByLabelText('API key');
    await userEvent.type(key, 'sk-1');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    expect(fake.patches()[0].body).toEqual({
      endpoints: [{ ...GROQ, apiKey: 'sk-1' }],
      config: { llm: { apiKey: 'sk-1' } },
    });
    expect(fake.chars.get('A')?.config.llm.apiKey).toBe('sk-1');
  });

  it('gathers two quick edits on different tabs into one save', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    withProvider(fake, 'tts', OPENAI);
    render(<Editor {...props()} />);
    await userEvent.click(await screen.findByLabelText(/Wake word/));
    await userEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    await userEvent.type(screen.getByLabelText('API key'), 'k');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    expect(fake.patches()[0].body).toEqual({
      endpoints: [{ ...OPENAI, apiKey: 'k' }],
      config: { wakeWord: true, tts: { apiKey: 'k' } },
    });
  });

  it('picks how the body moves, and says when it takes effect', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props()} />);
    const body = await screen.findByLabelText('Body');
    expect(body).toHaveValue('car');
    expect(screen.getByText(/next time the body connects/)).toBeInTheDocument();
    await userEvent.selectOptions(body, 'dry-run');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    expect(fake.patches()[0].body).toEqual({ config: { body: { motion: 'dry-run' } } });
  });

  it('renames through the name field', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    const p = props();
    render(<Editor {...p} />);
    const name = await screen.findByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Rex');
    await waitFor(() => expect(fake.chars.get('A')?.name).toBe('Rex'), { timeout: 2000 });
    expect(p.onChanged).toHaveBeenCalled();
  });

  it('keeps what was typed when a save fails, says so on this tab, and resends it with the next edit', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    withProvider(fake, 'llm', GROQ);
    render(<Editor {...props({ initialTab: 'llm' })} />);
    const key = await screen.findByLabelText('API key');
    fake.state.down = true;
    await userEvent.type(key, 'sk');
    expect(await screen.findByText(/Not saved/, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(key).toHaveValue('sk');
    fake.state.down = false;
    await userEvent.type(key, '9');
    await waitFor(() => expect(fake.chars.get('A')?.config.llm.apiKey).toBe('sk9'), { timeout: 2000 });
    expect(screen.queryByText(/Not saved/)).not.toBeInTheDocument();
  });

  it('picking a provider fills its address and model; a custom one asks for its own address', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'stt' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Provider'), 'groq');
    await waitFor(() => expect(fake.chars.get('A')?.config.stt.baseURL).toBe('https://api.groq.com/openai/v1'), { timeout: 2000 });
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), '__new__');
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
  });

  it('a provider with two sites says which one, and shows the address it fills in', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'llm' })} />);
    const provider = await screen.findByLabelText('Provider');
    expect(screen.getByRole('option', { name: 'Moonshot (Kimi) · China' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Moonshot (Kimi) · Global' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'DeepSeek' })).toBeInTheDocument();
    await userEvent.selectOptions(provider, 'moonshot-cn');
    expect(screen.getByText('api.moonshot.cn')).toBeInTheDocument();
    await waitFor(() => expect(fake.chars.get('A')?.config.llm.baseURL).toBe('https://api.moonshot.cn/v1'), { timeout: 2000 });
  });

  it('the test button shows what the check said, or why it failed', async () => {
    installFakeApi([{ name: 'A' }]);
    const check = vi.fn()
      .mockResolvedValueOnce('“ok” · move')
      .mockRejectedValueOnce(new Error('LLM request failed: 401 Unauthorized'));
    render(<Editor {...props({ initialTab: 'llm' })} check={check} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Test' }));
    expect(await screen.findByText('“ok” · move')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText(/401/)).toBeInTheDocument();
    expect(check).toHaveBeenLastCalledWith('llm', expect.objectContaining({ llm: expect.any(Object) }));
  });

  it('marks the reflex optional', async () => {
    installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    expect(await screen.findByText(/Optional/)).toBeInTheDocument();
  });

  it('shows the replace button and deletes only after confirming', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    const p = props();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Editor {...p} />);
    expect(await screen.findByRole('button', { name: 'New pairing code' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this character' }));
    expect(fake.chars.has('A')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Delete this character' }));
    await waitFor(() => expect(p.onDeleted).toHaveBeenCalled());
    expect(fake.chars.has('A')).toBe(false);
  });

  it('reflex: picking a preset saves its question, state and threshold', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Reflex preset'), 'commands');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    expect(fake.patches()[0].body.config.reflex.question).toEqual(REFLEX_PRESETS[1].question);
    expect(screen.getByLabelText('Option 4')).toHaveValue('left');
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
  });

  it('reflex: None turns it off, and the brain is told so', async () => {
    // Review focus 5: null must survive both deepMerges.
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    const preset = await screen.findByLabelText('Reflex preset');
    await userEvent.selectOptions(preset, 'bark');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    await userEvent.selectOptions(preset, 'none');
    await waitFor(() => expect(fake.patches()).toHaveLength(2), { timeout: 2000 });
    expect(fake.chars.get('A')?.config.reflex.question).toBeNull();
    expect(screen.queryByLabelText('Instructions')).toBeNull();
  });

  it('reflex: removing an option takes its actions with it', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Reflex preset'), 'commands');
    await userEvent.click(screen.getByRole('button', { name: 'Remove option left' }));
    await waitFor(() => expect(fake.chars.get('A')?.config.reflex.question?.options.map((o) => o.choice))
      .toEqual(['stop', 'forward', 'backward', 'right', 'keep_going', 'pass']), { timeout: 2000 });
    expect(screen.getByLabelText('Reflex preset')).toHaveValue('custom');
  });

  it('reflex: an action is edited in its row', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Reflex preset'), 'commands');
    await userEvent.selectOptions(screen.getByLabelText('left action 1 steer'), 'right');
    await waitFor(() => {
      const left = fake.chars.get('A')?.config.reflex.question?.options.find((o) => o.choice === 'left');
      expect(left?.actions[0].args.steps[0].steer).toBe('right');
    }, { timeout: 2000 });
    await userEvent.click(screen.getByRole('button', { name: 'Add action to pass' }));
    expect(screen.getByLabelText('pass action 1')).toHaveValue('move');
  });

  it('reflex: JSON edits keep actions by choice name', async () => {
    // Review focus 1: a key renamed and typed back still owns its actions.
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Reflex preset'), 'commands');
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const box = screen.getByLabelText('Question as JSON');
    const text = (box as HTMLTextAreaElement).value;
    fireEvent.change(box, { target: { value: text.replace('"left":', '"lef":') } });
    fireEvent.change(box, { target: { value: text } });
    await waitFor(() => {
      const left = fake.chars.get('A')?.config.reflex.question?.options.find((o) => o.choice === 'left');
      expect(left?.actions).toEqual(REFLEX_PRESETS[1].question.options[3].actions);
    }, { timeout: 2000 });
    fireEvent.change(box, { target: { value: '{ nope' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Not valid JSON/);
  });

  it('reflex: says which configured actions this body will ignore', async () => {
    installFakeApi([{ name: 'A' }]);
    render(<Editor {...props()} />);
    await userEvent.selectOptions(await screen.findByLabelText('Body'), 'none');
    await userEvent.click(screen.getByRole('tab', { name: 'Reflex' }));
    await userEvent.selectOptions(screen.getByLabelText('Reflex preset'), 'commands');
    expect(screen.getByRole('note')).toHaveTextContent(/move/);
  });

  it('reflex: Try asks the typed sentence and shows the answer', async () => {
    installFakeApi([{ name: 'A' }]);
    const tryReflex = vi.fn().mockResolvedValueOnce('“turn left” → fired (left 0.97, 180 ms) → move');
    render(<Editor {...props({ initialTab: 'reflex' })} tryReflex={tryReflex} />);
    await userEvent.selectOptions(await screen.findByLabelText('Reflex preset'), 'commands');
    await userEvent.type(screen.getByLabelText('Person said'), 'turn left');
    await userEvent.type(screen.getByLabelText('Robot said (optional)'), 'Okay!');
    await userEvent.click(screen.getByRole('button', { name: 'Try' }));
    expect(await screen.findByText(/fired \(left 0\.97/)).toBeInTheDocument();
    expect(tryReflex).toHaveBeenCalledWith(expect.objectContaining({ reflex: expect.any(Object) }), 'turn left', 'Okay!');
  });

  it('reflex: the JSON view follows a preset picked while it is open', async () => {
    // Final review I1: the box kept the old question, and the next keystroke
    // wrote it back over the preset.
    installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    const preset = await screen.findByLabelText('Reflex preset');
    await userEvent.selectOptions(preset, 'bark');
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    await userEvent.selectOptions(preset, 'commands');
    expect((screen.getByLabelText('Question as JSON') as HTMLTextAreaElement).value).toContain('"keep_going"');
  });

  it('reflex: leaving a hand-edited question asks first, and a no keeps it', async () => {
    // Final review I2: None and the presets replace the question outright.
    installFakeApi([{ name: 'A' }]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    const preset = await screen.findByLabelText('Reflex preset');
    await userEvent.selectOptions(preset, 'commands');
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove option left' }));
    await userEvent.selectOptions(preset, 'none');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Instructions')).toBeInTheDocument();
    await userEvent.selectOptions(preset, 'none');
    expect(screen.queryByLabelText('Instructions')).toBeNull();
  });

  it('reflex: says when the brain would read the question differently', async () => {
    // Final review I3: the brain normalises; the page showed what it would drop.
    installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Reflex preset'), 'commands');
    expect(screen.queryByText(/brain will read this differently/)).toBeNull();
    const second = screen.getByLabelText('Option 2');
    await userEvent.clear(second);
    await userEvent.type(second, 'stop');
    expect(screen.getByText(/brain will read this differently/)).toBeInTheDocument();
  });

  it('reflex: the last two options cannot be removed', async () => {
    installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'reflex' })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Write a question' }));
    expect(screen.getByRole('button', { name: 'Remove option yes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove option pass' })).toBeDisabled();
  });
});
