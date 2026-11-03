import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardSetup } from './BoardSetup';
import { installFakeApi } from './test/fakeApi';
import { fakeSerial } from './test/fakeSerial';

async function fill(ssid: string, pass: string) {
  await userEvent.type(await screen.findByLabelText(/wi-?fi name/i), ssid);
  await userEvent.type(screen.getByLabelText(/wi-?fi password/i), pass);
  await userEvent.selectOptions(await screen.findByLabelText(/character/i), 'Asten');
}

describe('BoardSetup', () => {
  it('without Web Serial says to use Chrome or Edge and shows no form', () => {
    installFakeApi([{ name: 'Asten' }]);
    render(<BoardSetup serial={fakeSerial({ supported: false }).serial} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Chrome or Edge/);
    expect(screen.queryByLabelText(/wi-?fi name/i)).toBeNull();
  });

  it('change settings: writes wifi, the picked character\'s token, reboots, and reports the connection', async () => {
    installFakeApi([{ name: 'Asten' }]);
    const f = fakeSerial();
    render(<BoardSetup serial={f.serial} />);
    await userEvent.click(await screen.findByLabelText(/change settings/i));
    await fill('My Home', 'secret12');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByText(/Connected to the brain as Asten/)).toBeInTheDocument();
    expect(f.written).toEqual([
      'wifi "My Home" "secret12"\n',
      `token ${'0'.repeat(31)}1\n`,
      'reboot\n',
    ]);
    expect(f.serial.flashBoard).not.toHaveBeenCalled();
    expect(f.serial.openBoard).toHaveBeenCalledTimes(1);
  });

  it('first time: flashes first and reuses the flashed port for the console', async () => {
    installFakeApi([{ name: 'Asten' }]);
    const f = fakeSerial();
    render(<BoardSetup serial={f.serial} />);
    await fill('My Home', 'secret12');   // "first time" is the default
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText(/Connected to the brain as Asten/);
    expect(f.events.slice(0, 2)).toEqual(['flash', 'open:flashed']);
    expect(f.serial.flashBoard).toHaveBeenCalledWith('/firmware/manifest.json', expect.any(Function));
  });

  it('refuses a name with a double quote and a short password before touching the port', async () => {
    installFakeApi([{ name: 'Asten' }]);
    const f = fakeSerial();
    render(<BoardSetup serial={f.serial} />);
    await fill('a"b', 'secret12');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/double quote/i);
    await userEvent.clear(screen.getByLabelText(/wi-?fi name/i));
    await userEvent.type(screen.getByLabelText(/wi-?fi name/i), 'ok');
    await userEvent.clear(screen.getByLabelText(/wi-?fi password/i));
    await userEvent.type(screen.getByLabelText(/wi-?fi password/i), 'short');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/8 to 63/);
    expect(f.serial.openBoard).not.toHaveBeenCalled();
    expect(f.serial.flashBoard).not.toHaveBeenCalled();
  });

  it('a board that never answers gets the "other USB port" hint', async () => {
    installFakeApi([{ name: 'Asten' }]);
    const f = fakeSerial({ answer: false });
    render(<BoardSetup serial={f.serial} replyTimeoutMs={20} />);
    await userEvent.click(await screen.findByLabelText(/change settings/i));
    await fill('My Home', 'secret12');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/other USB port/i);
  });
});
