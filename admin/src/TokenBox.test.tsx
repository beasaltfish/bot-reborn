import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenBox } from './TokenBox';
import { installFakeApi } from './test/fakeApi';

describe('TokenBox', () => {
  it('is masked until asked', async () => {
    render(<TokenBox id="A" token={'ab'.repeat(16)} onToken={() => {}} />);
    expect(screen.getByTestId('token')).not.toHaveTextContent('abab');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByTestId('token')).toHaveTextContent('ab'.repeat(16));
  });

  it('replaces only after confirming', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    const onToken = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TokenBox id="A" token="x" onToken={onToken} />);
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(fake.calls.some((c) => c.path.endsWith('/token'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith(fake.chars.get('A')?.token));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('copies the token', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<TokenBox id="A" token="tok" onToken={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('tok');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
