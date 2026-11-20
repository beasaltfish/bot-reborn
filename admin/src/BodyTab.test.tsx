import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BodyTab } from './BodyTab';
import type { Detail } from './types';

const detail = (id: 'car' | 'pet' | 'tarot' | 'dry-run' | 'none' = 'pet'): Detail => ({
  id: 'A', name: 'A', token: 't', config: {
    stt: { baseURL: '', apiKey: '', model: '', prompt: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    reflex: { baseURL: '', apiKey: '', model: '', enabled: true, threshold: 0.8, state: '', question: null },
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false,
    body: { id }, persona: '',
  }, endpoints: [], savedReflexes: [], online: false,
});

describe('BodyTab', () => {
  it('shows a card per body with its capabilities and what it cannot do', () => {
    render(<BodyTab detail={detail()} update={vi.fn()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    const pet = screen.getByRole('radio', { name: /pet on a screen/i });
    expect(pet).toBeChecked();
    expect(within(pet.closest('label') as HTMLElement).getByText(/cannot move/i)).toBeVisible();
  });

  it('says the body is a set of capabilities, not a firmware', () => {
    render(<BodyTab detail={detail()} update={vi.fn()} />);
    expect(screen.getByText(/not the firmware/i)).toBeInTheDocument();
  });

  it('a body with no firmware is not sent to the board, a phone body gets the QR code', () => {
    const update = vi.fn();
    render(<BodyTab detail={detail('none')} update={update} />);
    expect(screen.queryByText(/flash it once/i)).toBeNull();
    expect(screen.getByText(/scan the QR code/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /no moving parts/i })).toBeChecked();
  });

  it('picking a board body asks for the firmware, and writes the id', async () => {
    const update = vi.fn();
    render(<BodyTab detail={detail('none')} update={update} />);
    await userEvent.click(screen.getByRole('radio', { name: /^car/i }));
    expect(update).toHaveBeenCalledWith({ config: { body: { id: 'car' } } });
  });

  it('previews the chosen body and says it is not a simulation', () => {
    render(<BodyTab detail={detail('tarot')} update={vi.fn()} />);
    expect(screen.getByTestId('body-preview')).toHaveTextContent(/tarot reader/i);
    expect(screen.getByText(/not a simulation/i)).toBeInTheDocument();
  });
});
