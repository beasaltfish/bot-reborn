import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BodyTab } from './BodyTab';
import { installFakeApi } from './test/fakeApi';
import type { Detail } from './types';

const detail = (id: 'car' | 'pet' | 'tarot' | 'dry-run' | 'none' = 'pet'): Detail => ({
  id: 'A', name: 'A', token: 'ab'.repeat(16), config: {
    stt: { baseURL: '', apiKey: '', model: '', prompt: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    reflex: { baseURL: '', apiKey: '', model: '', enabled: true, threshold: 0.8, state: '', question: null },
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false,
    body: { id }, persona: '',
  }, endpoints: [], savedReflexes: [], online: false,
});

const renderTab = (d = detail(), update = vi.fn(), onToken = vi.fn()) =>
  render(<BodyTab detail={d} update={update} onToken={onToken} />);

afterEach(() => { vi.unstubAllGlobals(); });

describe('BodyTab', () => {
  it('shows a card per body with what it needs and what it does', () => {
    renderTab(detail());
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    const pet = screen.getByRole('radio', { name: /pet on a screen/i });
    expect(pet).toBeChecked();
    const card = within(pet.closest('label') as HTMLElement);
    expect(card.getByText(/hears you · speaks · shows/)).toBeVisible();
  });

  it('never spends a line on what a body cannot do', () => {
    renderTab(detail());
    expect(screen.queryByText(/cannot/i)).toBeNull();
  });

  it('says the body is a set of capabilities, not a firmware', () => {
    renderTab(detail());
    expect(screen.getByText(/not the firmware/i)).toBeInTheDocument();
  });

  it('a voice-only body can be a board or a phone, and says what each needs', () => {
    renderTab(detail('none'));
    const voice = screen.getByRole('radio', { name: /voice only/i });
    expect(voice).toBeChecked();
    const card = within(voice.closest('label') as HTMLElement);
    expect(card.getByText(/board · microphone · speaker amp/)).toBeVisible();
    expect(card.getByText(/^this phone$/)).toBeVisible();
  });

  it('a body that runs on a board or a phone gives both ways, not just one', () => {
    renderTab(detail('car'));
    expect(screen.getByText(/flash it once/i)).toBeInTheDocument();
    expect(screen.getByText(/FT232H/)).toBeInTheDocument();
    expect(screen.getByText(/scan the QR code/i)).toBeInTheDocument();
  });

  it('pairs the phone on the body it belongs to, not on Basic', async () => {
    installFakeApi();
    renderTab(detail('none'));
    expect(await screen.findByText(`http://192.168.1.5:8787/phone/#token=${'ab'.repeat(16)}`)).toBeInTheDocument();
  });

  it('a board-only body does not offer the phone', () => {
    installFakeApi();
    renderTab(detail('pet'));
    expect(screen.queryByText(/\/phone\/#token=/)).toBeNull();
  });

  it('picking a body writes its id', async () => {
    const update = vi.fn();
    renderTab(detail('none'), update);
    await userEvent.click(screen.getByRole('radio', { name: /^car/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { id: 'car' } } });
  });

  it('previews the chosen body with the frames the brain has, and says it is not a simulation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ pet: [], tarot: ['320x240/back.jpg'] }) })));
    renderTab(detail('tarot'));
    expect(await screen.findByRole('img', { name: 'Tarot reader' })).toHaveAttribute('src', '/preview/tarot/320x240/back.jpg');
    expect(screen.getByText(/not a simulation/i)).toBeInTheDocument();
  });

  it('a body with no art still names itself instead of showing a broken picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ pet: [], tarot: [] }) })));
    renderTab(detail('dry-run'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTestId('body-preview')).toHaveTextContent(/dry run/i);
  });
});
