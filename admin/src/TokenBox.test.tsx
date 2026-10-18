import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TokenBox } from './TokenBox';
import { installFakeApi } from './test/fakeApi';

describe('TokenBox', () => {
  it('replaces only after confirming', async () => {
    const fake = installFakeApi([{ name: 'A' }]);
    const onToken = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TokenBox id="A" onToken={onToken} />);
    await userEvent.click(screen.getByRole('button', { name: 'New pairing code' }));
    expect(fake.calls.some((c) => c.path.endsWith('/token'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'New pairing code' }));
    await vi.waitFor(() => expect(onToken).toHaveBeenCalledWith(fake.chars.get('A')?.token));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('shows no token on screen', () => {
    render(<TokenBox id="A" onToken={() => {}} />);
    expect(screen.queryByTestId('token')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });
});
