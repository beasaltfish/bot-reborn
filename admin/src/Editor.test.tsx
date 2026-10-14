import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Editor } from './Editor';
import { installFakeApi } from './test/fakeApi';
import type { EditorSlot } from './types';

const props = (over: Partial<EditorSlot> = {}): EditorSlot =>
  ({ id: 'A', online: false, initialTab: 'basic', onChanged: vi.fn(), onDeleted: vi.fn(), ...over });

describe('Editor', () => {
  it('saves only what changed, once, after typing stops', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'llm' })} />);
    const key = await screen.findByLabelText('API key');
    await userEvent.type(key, 'sk-1');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    expect(fake.patches()[0].body).toEqual({ config: { llm: { apiKey: 'sk-1' } } });
    expect(fake.chars.get('A')?.config.llm.apiKey).toBe('sk-1');
  });

  it('gathers two quick edits on different tabs into one save', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props()} />);
    await userEvent.click(await screen.findByLabelText(/Wake word/));
    await userEvent.click(screen.getByRole('tab', { name: 'Voice' }));
    await userEvent.type(screen.getByLabelText('API key'), 'k');
    await waitFor(() => expect(fake.patches()).toHaveLength(1), { timeout: 2000 });
    expect(fake.patches()[0].body).toEqual({ config: { wakeWord: true, tts: { apiKey: 'k' } } });
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

  it('picking a provider fills its address and model; Other asks for them', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<Editor {...props({ initialTab: 'stt' })} />);
    await userEvent.selectOptions(await screen.findByLabelText('Provider'), 'groq');
    await waitFor(() => expect(fake.chars.get('A')?.config.stt.baseURL).toBe('https://api.groq.com/openai/v1'), { timeout: 2000 });
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
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
});
