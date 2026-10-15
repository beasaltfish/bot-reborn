import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhoneLink } from './PhoneLink';
import { installFakeApi } from './test/fakeApi';

const TOKEN = 'ab'.repeat(16);

describe('PhoneLink', () => {
  it('shows the phone address with the token in its fragment, and a code for it', async () => {
    installFakeApi();
    render(<PhoneLink token={TOKEN} />);
    expect(await screen.findByText(`http://192.168.1.5:8787/phone/#token=${TOKEN}`)).toBeInTheDocument();
    // The SVG is drawn asynchronously, after the address is already on screen.
    await vi.waitFor(() => expect(screen.getByTestId('qr').innerHTML).toMatch(/<svg/));
  });

  it('says which Chrome flag the phone needs, with the exact origin to paste', async () => {
    installFakeApi();
    render(<PhoneLink token={TOKEN} />);
    expect(await screen.findByText('chrome://flags/#unsafely-treat-insecure-origin-as-secure')).toBeInTheDocument();
    expect(screen.getByText('http://192.168.1.5:8787')).toBeInTheDocument();
  });

  it('offers a choice when the computer is on more than one network', async () => {
    const fake = installFakeApi();
    fake.state.addresses = ['192.168.1.5', '10.0.0.7'];
    render(<PhoneLink token={TOKEN} />);
    await userEvent.selectOptions(await screen.findByRole('combobox'), '10.0.0.7');
    expect(screen.getByText(`http://10.0.0.7:8787/phone/#token=${TOKEN}`)).toBeInTheDocument();
  });

  it('says so when the computer is on no network a phone could share', async () => {
    const fake = installFakeApi();
    fake.state.addresses = [];
    render(<PhoneLink token={TOKEN} />);
    expect(await screen.findByText(/no network/i)).toBeInTheDocument();
  });
});
