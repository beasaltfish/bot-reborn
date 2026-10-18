import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyProvider } from './CopyProvider';
import { installFakeApi } from './test/fakeApi';
import type { Endpoint } from './types';

const GROQ: Endpoint = { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: 'gsk-b' };

describe('CopyProvider', () => {
  it('offers the providers another character has for this layer, and hands the one picked over with its key', async () => {
    const fake = installFakeApi([{ name: 'A' }, { name: 'B' }]);
    fake.chars.get('B')!.endpoints = [GROQ];
    const onPick = vi.fn();
    render(<CopyProvider id="A" layer="stt" onPick={onPick} />);
    await userEvent.selectOptions(await screen.findByLabelText('Copy provider from another character'), 'B');
    await userEvent.selectOptions(await screen.findByLabelText('Choose a provider to copy…'), 'groq');
    expect(onPick).toHaveBeenCalledWith(GROQ);
  });

  it('does not offer a preset that this layer cannot use', async () => {
    const fake = installFakeApi([{ name: 'A' }, { name: 'B' }]);
    fake.chars.get('B')!.endpoints = [{ id: 'openrouter', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'or' }];
    render(<CopyProvider id="A" layer="stt" onPick={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText('Copy provider from another character'), 'B');
    expect(await screen.findByText('That character has no provider this layer can use.')).toBeInTheDocument();
  });

  it('is hidden when there is no other character', async () => {
    installFakeApi([{ name: 'A' }]);
    render(<CopyProvider id="A" layer="stt" onPick={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText('Copy provider from another character')).not.toBeInTheDocument();
  });
});
