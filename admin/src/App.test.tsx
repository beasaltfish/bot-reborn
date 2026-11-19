import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { api } from './api';
import { rememberBoard } from './boardMemory';
import { installFakeApi } from './test/fakeApi';
import { Editor } from './Editor';
import type { EditorSlot, Summary } from './types';

const slot = (p: EditorSlot) => <div data-testid="editor">{`${p.id}:${p.initialTab}`}</div>;

describe('App', () => {
  afterEach(() => localStorage.clear());

  it('offers only the first character when there are none', async () => {
    installFakeApi();
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByRole('button', { name: 'Create your first character' })).toBeInTheDocument();
    expect(screen.queryByText('Characters')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'First-time setup' })).not.toBeInTheDocument();
  });

  it('places setup above the active editor and skips flashing after a phone connects', async () => {
    const phone: Summary = { id: 'Pocket', name: 'Pocket', motion: 'none', ready: true, online: false, bodyKind: 'phone' };
    const pet: Summary = { id: 'Rex', name: 'Rex', motion: 'pet', ready: false, online: false };
    vi.spyOn(api, 'list').mockImplementation(async () => [{ ...phone }, { ...pet }]);
    render(<App pollMs={50} renderEditor={slot} />);

    const card = await screen.findByRole('region', { name: 'First-time setup' });
    const editor = screen.getByTestId('editor');
    expect(card.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(editor).toHaveTextContent('Pocket:basic');
    expect(within(card).getByRole('status')).toHaveTextContent('Next: Connect a body');
    expect(within(card).getByText('2 of 4 complete')).toBeVisible();

    phone.online = true;
    phone.lastSeenAt = 1;
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Next: Hear the first reply'));
    const rows = within(card).getAllByRole('listitem');
    expect(within(rows[2]).getByText('Skipped')).toBeVisible();
    expect(within(rows[3]).getByText('From this brain')).toBeVisible();
    expect(within(card).getByText('3 of 4 complete')).toBeVisible();

    phone.lastSpokeAt = 2;
    expect(await within(card).findByText('Setup complete', { selector: 'summary' })).toBeVisible();

    // A brain restart forgets the observations even if the character keeps its keys.
    delete phone.lastSeenAt;
    delete phone.lastSpokeAt;
    phone.online = false;
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Next: Connect a body'));

    await userEvent.click(screen.getByRole('button', { name: /Rex/ }));
    const petCard = screen.getByRole('region', { name: 'First-time setup' });
    expect(screen.getByTestId('editor')).toHaveTextContent('Rex:basic');
    expect(within(petCard).getByRole('status')).toHaveTextContent('Next: Add three keys');
    expect(within(petCard).getByText('1 of 5 complete')).toBeVisible();
    expect(within(petCard).queryByText('Skipped')).not.toBeInTheDocument();
  });

  it('refreshes after editor saves and reads board memory on returning from board setup', async () => {
    const pet: Summary = { id: 'Rex', name: 'Rex', motion: 'pet', ready: false, online: false };
    vi.spyOn(api, 'list').mockImplementation(async () => [{ ...pet }]);
    const editorWithSave = (p: EditorSlot) => <button onClick={p.onChanged}>Save editor changes</button>;
    render(<App pollMs={60_000} renderEditor={editorWithSave} />);

    const card = await screen.findByRole('region', { name: 'First-time setup' });
    expect(within(card).getByRole('status')).toHaveTextContent('Next: Add three keys');
    pet.ready = true;
    await userEvent.click(screen.getByRole('button', { name: 'Save editor changes' }));
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Next: Flash the board (board bodies only)'));

    await userEvent.click(screen.getByRole('button', { name: 'Set up a board' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chrome or Edge/);
    expect(screen.queryByRole('region', { name: 'First-time setup' })).not.toBeInTheDocument();
    rememberBoard({ characterId: 'Rex', screen: null, flashedAt: 2 });
    await userEvent.click(screen.getByRole('button', { name: /Rex/ }));

    const returnedCard = screen.getByRole('region', { name: 'First-time setup' });
    const rows = within(returnedCard).getAllByRole('listitem');
    expect(within(rows[2]).getByText('In this browser')).toBeVisible();
    expect(within(rows[3]).getByText('In this browser')).toBeVisible();
    expect(within(returnedCard).getByRole('status')).toHaveTextContent('Next: Hear the first reply');
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

  it('opens the board setup from the list and leaves it when a character is picked', async () => {
    installFakeApi([{ name: 'Rex' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Set up a board' }));
    // jsdom has no Web Serial, so the screen opens on its Chrome-or-Edge notice.
    expect(await screen.findByRole('alert')).toHaveTextContent(/Chrome or Edge/);
    await userEvent.click(screen.getByRole('button', { name: /Rex/ }));
    expect(await screen.findByTestId('editor')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a create error instead of swallowing it', async () => {
    installFakeApi([{ name: 'Rex' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ New character' }));
    await userEvent.type(screen.getByPlaceholderText('Name, e.g. Rex'), 'Rex');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });

  it('opens the first character instead of an empty pane', async () => {
    localStorage.clear();
    installFakeApi([{ name: 'A' }, { name: 'B' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByTestId('editor')).toHaveTextContent('A:basic');
  });

  it('reopens the character looked at last time', async () => {
    localStorage.clear();
    installFakeApi([{ name: 'A' }, { name: 'B' }]);
    const first = render(<App pollMs={50} renderEditor={slot} />);
    await userEvent.click(await screen.findByRole('button', { name: /B/ }));
    expect(await screen.findByTestId('editor')).toHaveTextContent('B:basic');
    first.unmount();
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByTestId('editor')).toHaveTextContent('B:basic');
  });

  it('falls back to the first when the remembered one is gone', async () => {
    localStorage.setItem('admin.character', 'Gone');
    installFakeApi([{ name: 'A' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByTestId('editor')).toHaveTextContent('A:basic');
  });

  it('opens the character a #character= link names, over the remembered one', async () => {
    localStorage.setItem('admin.character', 'A');
    location.hash = '#character=Petty';
    installFakeApi([{ name: 'A' }, { name: 'Petty' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByTestId('editor')).toHaveTextContent('Petty:basic');
    location.hash = '';
  });

  it('follows the link when the hash changes, and ignores an id that is not listed', async () => {
    localStorage.clear();
    location.hash = '';
    installFakeApi([{ name: 'A' }, { name: 'B' }]);
    render(<App pollMs={50} renderEditor={slot} />);
    expect(await screen.findByTestId('editor')).toHaveTextContent('A:basic');
    act(() => { location.hash = '#character=B'; });
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveTextContent('B:basic'));
    act(() => { location.hash = '#character=Nope'; });
    await waitFor(() => expect(screen.getByTestId('editor')).toHaveTextContent('A:basic'));
    location.hash = '';
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

  it('keeps one setup card when characters are switched', async () => {
    localStorage.clear();
    installFakeApi([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    render(<App pollMs={50} renderEditor={(p) => <Editor key={p.id} {...p} />} />);
    await screen.findByRole('heading', { name: 'A' });
    for (const name of ['B', 'C', 'A', 'B']) {
      await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
      await screen.findByRole('heading', { name });
    }
    // Two siblings with the same key made React append a card per switch.
    expect(document.querySelectorAll('section.setup')).toHaveLength(1);
  });
