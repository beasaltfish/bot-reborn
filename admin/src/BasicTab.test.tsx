import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BasicTab } from './BasicTab';
import type { Detail } from './types';

const detail = (): Detail => ({
  id: 'A', name: 'A', token: 'ab'.repeat(16), config: {
    stt: { baseURL: '', apiKey: '', model: '', prompt: '' },
    llm: { baseURL: '', apiKey: '', model: '' },
    tts: { baseURL: '', apiKey: '', model: '', voice: '' },
    reflex: { baseURL: '', apiKey: '', model: '', enabled: true, threshold: 0.8, state: '', question: null },
    lang: 'en', replyLang: null, bargeIn: true, wakeWord: false,
    body: { id: 'toy' }, persona: '',
  }, endpoints: [], savedReflexes: [], online: false,
});

const renderTab = (advanced?: ReactNode) =>
  render(<BasicTab detail={detail()} update={vi.fn()} onToken={vi.fn()} advanced={advanced} />);

describe('BasicTab', () => {
  it('puts what it is given under Advanced, closed', () => {
    const { container } = renderTab(<p>body cards</p>);
    const section = container.querySelector('details.advanced');
    expect(section).not.toBeNull();
    expect(section).not.toHaveAttribute('open');
    expect(screen.getByText('Advanced')).toBeInTheDocument();
    expect(screen.getByText('body cards')).toBeInTheDocument();
  });

  it('has no Advanced section when it is given none', () => {
    renderTab();
    expect(screen.queryByText('Advanced')).toBeNull();
  });

  it('still pairs the phone and edits the basics', () => {
    renderTab();
    expect(screen.getByLabelText('Name')).toHaveValue('A');
    expect(screen.getByRole('button', { name: 'New pairing code' })).toBeInTheDocument();
  });
});
