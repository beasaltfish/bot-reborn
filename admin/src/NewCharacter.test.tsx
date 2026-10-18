import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewCharacter } from './NewCharacter';
import { installFakeApi } from './test/fakeApi';

describe('NewCharacter', () => {
  it('starts with the providers and their keys of the character picked, and nothing else', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    const a = fake.chars.get('A')!;
    a.config.llm = { baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-a', model: 'llama' };
    a.endpoints = [
      { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-a' },
      { id: 'ep-1', name: 'Home', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-other', custom: true },
    ];
    a.config.lang = 'zh';
    a.config.wakeWord = true;
    const onCreated = vi.fn();
    render(<NewCharacter onCreated={onCreated} />);
    await userEvent.type(screen.getByRole('textbox'), 'B');
    await userEvent.selectOptions(await screen.findByLabelText('Providers and keys copied from'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const b = fake.chars.get('B')!;
    expect(b.config.llm).toMatchObject({ baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-a', model: 'llama' });
    expect(b.endpoints).toEqual(a.endpoints);
    expect(b.config.lang).toBe('en');
    expect(b.config.wakeWord).toBe(false);
  });

  it('starts blank when nothing is picked', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    fake.chars.get('A')!.config.llm = { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' };
    render(<NewCharacter onCreated={() => {}} />);
    await userEvent.type(screen.getByRole('textbox'), 'B');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(fake.chars.has('B')).toBe(true));
    expect(fake.chars.get('B')!.config.llm.apiKey).toBe('');
  });
});
