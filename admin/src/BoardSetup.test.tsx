import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      'url auto\n',   // a url typed by hand earlier would stop the board looking for the brain
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

  it('reads the board back: fills the name, the password in plain text, and picks the character by its token', async () => {
    installFakeApi([{ name: 'Rex' }, { name: 'Asten' }]);
    const f = fakeSerial();
    render(<BoardSetup serial={f.serial} />);
    await userEvent.click(await screen.findByLabelText(/change settings/i));
    await userEvent.click(screen.getByRole('button', { name: /read from the board/i }));
    await vi.waitFor(() => expect(screen.getByLabelText(/wi-?fi name/i)).toHaveValue('HomeNet'));
    const pass = screen.getByLabelText(/wi-?fi password/i);
    expect(pass).toHaveValue('secret12');
    expect(pass).toHaveAttribute('type', 'text');
    // The fake brain hands out tokens in creation order: Rex …01, Asten …02. The board holds …01.
    expect(screen.getByLabelText(/character/i)).toHaveValue('Rex');
    expect(f.events).toContain('close');
    expect(f.written).toEqual(['show\n']);
  });

  it('says so when the board holds a token that is none of this brain\'s characters', async () => {
    installFakeApi([{ name: 'Rex' }]);
    const f = fakeSerial({ token: 'f'.repeat(32) });
    render(<BoardSetup serial={f.serial} />);
    await userEvent.click(await screen.findByLabelText(/change settings/i));
    await userEvent.click(screen.getByRole('button', { name: /read from the board/i }));
    expect(await screen.findByText(/none of this brain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/wi-?fi name/i)).toHaveValue('HomeNet');
  });
});

describe('the screen picker', () => {
  beforeEach(() => { installFakeApi([{ name: 'Asten' }]); });

  const screens = [
    { id: 'ili9341-ips', label: 'ILI9341V 2.8" IPS', labelZh: 'ILI9341V 2.8 寸 IPS', verified: true, controller: 'ili9341' },
    { id: 'st7735-160', label: 'ST7735 1.8" TFT', verified: true, controller: 'st7735' },
    { id: 'st7789-240', label: 'ST7789 1.3" IPS', verified: false, controller: 'st7789' },
  ] as unknown as Parameters<typeof BoardSetup>[0]['screens'];

  async function fillFloor() {
    await userEvent.type(await screen.findByLabelText(/wi-?fi name/i), 'HomeNet');
    await userEvent.type(screen.getByLabelText(/wi-?fi password/i), 'secret12');
    await userEvent.selectOptions(await screen.findByLabelText(/character/i), 'Asten');
  }

  it('offers only panels that are verified and that the firmware drives', async () => {
    const { serial } = fakeSerial();
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={screens} />);
    const picker = await screen.findByLabelText(/screen/i);
    const values = [...(picker as HTMLSelectElement).options].map((o) => o.value);
    expect(values).toEqual(['keep', 'off', 'ili9341-ips']);
  });

  it('writes the screen before the single reboot', async () => {
    const { serial, written } = fakeSerial();
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={screens} />);
    await fillFloor();
    await userEvent.selectOptions(screen.getByLabelText(/screen/i), 'ili9341-ips');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText(/Connected to the brain as Asten/);
    const order = written.map((line) => line.trim());
    expect(order).toContain('screen ili9341-ips');
    expect(order.indexOf('screen ili9341-ips')).toBeLessThan(order.indexOf('reboot'));
    expect(order.filter((line) => line === 'reboot')).toHaveLength(1);
  });

  it('leaves the board\'s screen alone unless the user changes it', async () => {
    const { serial, written } = fakeSerial();
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={screens} />);
    await fillFloor();
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText(/Connected to the brain as Asten/);
    expect(written.some((line) => line.startsWith('screen'))).toBe(false);
  });

  it('clears the screen when the user asks for no screen', async () => {
    const { serial, written } = fakeSerial({ screen: 'ili9341-ips' });
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={screens} />);
    await fillFloor();
    await userEvent.selectOptions(screen.getByLabelText(/screen/i), 'off');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText(/Connected to the brain as Asten/);
    const order = written.map((line) => line.trim());
    expect(order).toContain('screen off');
    expect(order.indexOf('screen off')).toBeLessThan(order.indexOf('reboot'));
  });

  it('names a model the page cannot offer, and never writes it back', async () => {
    const { serial, written } = fakeSerial({ screen: 'st7735-160' });
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={screens} />);
    await userEvent.click(await screen.findByLabelText(/change settings/i));
    await userEvent.click(screen.getByRole('button', { name: /read/i }));
    expect(await screen.findByText(/ST7735 1\.8/)).toBeInTheDocument();
    await fillFloor();
    await userEvent.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText(/Connected to the brain as Asten/);
    expect(written.some((line) => line.startsWith('screen'))).toBe(false);
  });

  it('does not touch the choice when an older firmware has no screen line', async () => {
    const { serial } = fakeSerial({ screen: undefined });
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={screens} />);
    await userEvent.click(await screen.findByLabelText(/change settings/i));
    await userEvent.click(screen.getByRole('button', { name: /read/i }));
    expect(await screen.findByText(/Filled in from the board/)).toBeInTheDocument();
    expect((screen.getByLabelText(/screen/i) as HTMLSelectElement).value).toBe('keep');
  });

  it('says why there is nothing to pick instead of showing a dead dropdown', async () => {
    const { serial } = fakeSerial();
    render(<BoardSetup serial={serial} replyTimeoutMs={50} screens={[]} />);
    expect(await screen.findByText(/no model has been verified on a real board yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/screen/i)).toBeDisabled();
  });
});
