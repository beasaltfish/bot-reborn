import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { installFakeApi } from './test/fakeApi';
import type { EditorSlot } from './types';

const slot = (p: EditorSlot) => <div data-testid="editor">{`${p.id}:${p.initialTab}`}</div>;

describe('App', () => {
  it('offers only the first character when there are none', async () => {
    installFakeApi();
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByRole('button', { name: 'Create your first character' })).toBeInTheDocument();
    expect(screen.queryByText('Characters')).not.toBeInTheDocument();
  });

  it('creates a character, lists it and opens it on the Ears tab', async () => {
    const fake = installFakeApi();
    render(<App pollMs={50} renderEditor={slot} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create your first character' }));
    await userEvent.type(screen.getByPlaceholderText('Name, e.g. Rex'), 'Rex');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByTestId('editor')).toHaveTextContent('Rex:stt');
    expect(await screen.findByRole('button', { name: /Rex/ })).toBeInTheDocument();
    expect(fake.chars.has('Rex')).toBe(true);
  });

  it('shows a create error instead of swallowing it', async () => {
    installFakeApi([{ name: 'Rex' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New character' }));
    await userEvent.type(screen.getByPlaceholderText('Name, e.g. Rex'), 'Rex');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('marks who is online and who is missing keys', async () => {
    installFakeApi([{ name: 'A', online: true }, { name: 'B' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    const a = await screen.findByRole('button', { name: /A/ });
    expect(a).toHaveTextContent('Online');
    expect(screen.getByRole('button', { name: /B/ })).toHaveTextContent('Offline');
    expect(a).toHaveTextContent('Missing keys');
  });

  it('says so when the brain stops answering, and recovers by itself', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    await screen.findByRole('button', { name: /A/ });
    fake.state.down = true;
    expect(await screen.findByText(/The brain is not running/)).toBeInTheDocument();
    fake.state.down = false;
    await waitFor(() => expect(screen.queryByText(/The brain is not running/)).not.toBeInTheDocument());
  });

  it('sends the custom header on every call', async () => {
    const fake = installFakeApi();
    render(<App pollMs={50} renderEditor={slot} />);
    await screen.findByRole('button', { name: 'Create your first character' });
    expect(fake.calls.every((c) => c.headers['X-Bot-Reborn'] === '1')).toBe(true);
  });
});
