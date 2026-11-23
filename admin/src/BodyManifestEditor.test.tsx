// The bench half of a body, edited in the admin: a pin number and the examples
// the model reads. A save always writes a new body, never over one that exists.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TEMPLATES, registerPlugins } from '../../core/bodies.js';
import { BodyManifestEditor } from './BodyManifestEditor';

const wired = () => ({
  ...structuredClone(TEMPLATES.none),
  id: 'led-module',
  template: 'led-module',
  label: { en: 'LED module', zh: 'LED 模块' },
  parts: ['esp32', 'led-5mm'],
  resources: [{ kind: 'gpio', name: 'led', gpio: 5, direction: 'output', safe: 0 }],
  commands: [{ name: 'led_on', run: [{ op: 'pin.write', args: { pin: 'led', level: 1 } }], timeoutMs: 500 }],
  actions: [{ name: 'light_up', label: { en: 'Light up', zh: '点亮' }, say: 'On.', run: [{ command: 'led_on' }] }],
  wiring: { links: [{ a: 'esp:GPIO5', b: 'led:A' }] },
});

const renderEditor = (over: Partial<ReturnType<typeof wired>> = {}) => {
  const body = { ...wired(), ...over };
  render(
    <BodyManifestEditor
      body={/** @type {any} */ (body)}
      resources={body.resources}
      commands={body.commands}
      actions={/** @type {any} */ (body.actions)}
      wiring={body.wiring}
      parts={body.parts}
    />,
  );
  return body;
};

beforeEach(() => {
  registerPlugins({});
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'bench-led' }) })) as any;
});

describe('BodyManifestEditor', () => {
  it('saves the pins and the examples as a new body', async () => {
    renderEditor();
    await userEvent.click(screen.getByText(/Pins and examples of led-module/));
    await userEvent.type(screen.getByLabelText(/Save as/), 'bench-led');
    await userEvent.clear(screen.getByLabelText(/gpio \(led\)/));
    await userEvent.type(screen.getByLabelText(/gpio \(led\)/), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Save as a new body' }));
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/bodies/save', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(sent.resources[0].gpio).toBe(6);
    expect(sent.examples).toHaveLength(1);
    expect(sent.id).toBe('bench-led');
    expect(await screen.findByText(/Saved as bench-led/)).toBeInTheDocument();
  });

  it('says why a body with no example action cannot be saved', async () => {
    renderEditor({ actions: [] });
    await userEvent.click(screen.getByText(/Pins and examples of led-module/));
    expect(screen.getByRole('button', { name: 'Save as a new body' })).toBeDisabled();
  });

  it('needs a name before it writes anything', async () => {
    renderEditor();
    await userEvent.click(screen.getByText(/Pins and examples of led-module/));
    await userEvent.click(screen.getByRole('button', { name: 'Save as a new body' }));
    expect(await screen.findByText(/Give the new body a name/)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
