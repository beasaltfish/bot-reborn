import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerTab } from './LayerTab';
import { blankConfig, installFakeApi } from './test/fakeApi';
import type { Endpoint } from './types';

const GROQ = 'https://api.groq.com/openai/v1';
const groq: Endpoint = { id: 'groq', name: 'Groq', baseURL: GROQ, apiKey: 'gsk-1' };
const home: Endpoint = { id: 'ep-1', name: 'Home', baseURL: 'http://10.0.0.5/v1', apiKey: 'k1', custom: true };

function setup(over: { llm?: object; endpoints?: Endpoint[]; layer?: 'llm' | 'stt' | 'tts' | 'reflex' } = {}) {
  const config = blankConfig();
  if (over.llm) config.llm = { ...config.llm, ...over.llm };
  const update = vi.fn();
  const layer = over.layer ?? 'llm';
  render(<LayerTab id="A" layer={layer} config={config} endpoints={over.endpoints ?? []} update={update} check={vi.fn()} />);
  return { update };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('LayerTab providers', () => {
  it('picking a preset whose entry has a key gives the layer that key', async () => {
    const { update } = setup({ endpoints: [groq] });
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'groq');
    expect(update).toHaveBeenCalledWith({ config: { llm: expect.objectContaining({ endpointId: 'groq', baseURL: GROQ, apiKey: 'gsk-1' }) } });
  });

  it('picking a preset with no entry yet makes one, with no key', async () => {
    const { update } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'groq');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      endpoints: [{ id: 'groq', name: 'Groq', baseURL: GROQ, apiKey: '' }],
      config: { llm: expect.objectContaining({ endpointId: 'groq', apiKey: '' }) },
    }));
  });

  it('switching to a custom provider brings its key, and switching away keeps the old key', async () => {
    const { update } = setup({ endpoints: [groq, home], llm: { endpointId: 'groq', baseURL: GROQ, apiKey: 'gsk-1' } });
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'ep-1');
    expect(update).toHaveBeenCalledWith({ config: { llm: { endpointId: 'ep-1', baseURL: 'http://10.0.0.5/v1', apiKey: 'k1' } } });
    expect(update.mock.calls[0][0].endpoints).toBeUndefined();
  });

  it('a key typed goes to the entry, and every layer using the entry follows', async () => {
    const { update } = setup({ endpoints: [groq], llm: { endpointId: 'groq', baseURL: GROQ, apiKey: 'gsk-1' } });
    await userEvent.type(screen.getByLabelText('API key'), 'x');
    expect(update).toHaveBeenLastCalledWith({
      endpoints: [{ ...groq, apiKey: 'gsk-1x' }],
      config: { llm: { apiKey: 'gsk-1x' } },
    });
  });

  it('adding a custom provider saves a name and an address as an entry the layer uses', async () => {
    const { update } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), '__new__');
    await userEvent.type(screen.getByLabelText('Name'), 'Office');
    await userEvent.type(screen.getByLabelText('Base URL'), 'http://10.0.0.9/v1/');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const call = update.mock.calls[0][0];
    expect(call.endpoints).toEqual([expect.objectContaining({ name: 'Office', baseURL: 'http://10.0.0.9/v1', apiKey: '', custom: true })]);
    expect(call.config.llm).toEqual({ endpointId: call.endpoints[0].id, baseURL: 'http://10.0.0.9/v1', apiKey: '' });
  });

  it('an address without http or https is refused, and nothing is saved', async () => {
    const { update } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), '__new__');
    await userEvent.type(screen.getByLabelText('Name'), 'Office');
    await userEvent.type(screen.getByLabelText('Base URL'), 'groq.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('http:// or https://');
    expect(update).not.toHaveBeenCalled();
  });

  it('editing a custom address changes the layers that use it', async () => {
    const { update } = setup({ endpoints: [home], llm: { endpointId: 'ep-1', baseURL: home.baseURL, apiKey: 'k1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const url = screen.getByLabelText('Base URL');
    await userEvent.clear(url);
    await userEvent.type(url, 'http://10.0.0.6/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith({
      endpoints: [{ ...home, baseURL: 'http://10.0.0.6/v1' }],
      config: { llm: { baseURL: 'http://10.0.0.6/v1' } },
    });
  });

  it('deleting asks first, names the layers using it, and blanks them', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { update } = setup({ endpoints: [home], llm: { endpointId: 'ep-1', baseURL: home.baseURL, apiKey: 'k1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm.mock.calls[0][0]).toContain('llm');
    expect(update).toHaveBeenCalledWith({
      endpoints: [],
      config: { llm: { endpointId: '', baseURL: '', apiKey: '' } },
    });
  });

  it('a delete that is not confirmed does nothing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { update } = setup({ endpoints: [home], llm: { endpointId: 'ep-1', baseURL: home.baseURL, apiKey: 'k1' } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(update).not.toHaveBeenCalled();
  });

  it('no more than 50 custom providers', async () => {
    const many: Endpoint[] = Array.from({ length: 50 }, (_, i) => ({ id: `ep-${i}`, name: `n${i}`, baseURL: 'http://x/v1', apiKey: '', custom: true }));
    const { update } = setup({ endpoints: many });
    await userEvent.selectOptions(screen.getByLabelText('Provider'), '__new__');
    await userEvent.type(screen.getByLabelText('Name'), 'One more');
    await userEvent.type(screen.getByLabelText('Base URL'), 'http://y/v1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Up to 50');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('LayerTab copying a provider', () => {
  it('a provider copied from another character is added with its key, and the layer uses it', async () => {
    const fake = installFakeApi([{ name: 'A' }, { name: 'B' }]);
    fake.chars.get('B')!.endpoints = [groq];
    const config = blankConfig();
    const update = vi.fn();
    render(<LayerTab id="A" layer="llm" config={config} endpoints={[]} update={update} check={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByLabelText('Copy provider from another character'), 'B');
    await userEvent.selectOptions(await screen.findByLabelText('Choose a provider to copy…'), 'groq');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      endpoints: [groq],
      config: { llm: expect.objectContaining({ endpointId: 'groq', baseURL: groq.baseURL, apiKey: 'gsk-1' }) },
    }));
  });
});

const VOLC = 'https://openspeech.bytedance.com';
const volc: Endpoint = { id: 'volcengine', name: 'Volcengine 火山引擎', baseURL: VOLC, apiKey: 'v-1' };
const openai: Endpoint = { id: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-1' };

function setupTts(tts: object, endpoints: Endpoint[]) {
  const config = blankConfig();
  config.tts = { ...config.tts, ...tts };
  const update = vi.fn();
  render(<LayerTab id="A" layer="tts" config={config} endpoints={endpoints} update={update} check={vi.fn()} />);
  return { update };
}

describe('LayerTab voices', () => {
  const onVolc = (voice: string) => setupTts(
    { endpointId: 'volcengine', baseURL: VOLC, apiKey: 'v-1', model: 'seed-tts-2.0', voice }, [volc]);

  it('Volcengine voices show their labels and store the id', async () => {
    const { update } = onVolc('zh_female_xiaohe_uranus_bigtts');
    const select = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('小何 2.0');
    await userEvent.selectOptions(select, 'Vivi 2.0');
    expect(update).toHaveBeenLastCalledWith({ config: { tts: { voice: 'zh_female_vv_uranus_bigtts' } } });
  });

  it('Other opens a voice ID field with the full list link beside it', async () => {
    const { update } = onVolc('zh_female_xiaohe_uranus_bigtts');
    expect(screen.queryByLabelText('Voice ID')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Voice'), '');
    const link = screen.getByRole('link', { name: 'Full voice list' });
    expect(link).toHaveAttribute('href', 'https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    await userEvent.type(screen.getByLabelText('Voice ID'), 'x');
    expect(update).toHaveBeenLastCalledWith({ config: { tts: { voice: 'zh_female_xiaohe_uranus_bigttsx' } } });
  });

  it('a stored voice that is not listed opens as Other with its id filled in', () => {
    const { update } = onVolc('ICL_uranus_zh_female_aojiaonvyou_tob');
    expect((screen.getByLabelText('Voice') as HTMLSelectElement).value).toBe('');
    expect(screen.getByLabelText('Voice ID')).toHaveValue('ICL_uranus_zh_female_aojiaonvyou_tob');
    expect(update).not.toHaveBeenCalled();
  });

  it('OpenAI voices are unchanged: label is the id, no link', async () => {
    setupTts({ endpointId: 'openai', baseURL: 'https://api.openai.com/v1', apiKey: 'sk-1', model: 'gpt-4o-mini-tts', voice: 'nova' }, [openai]);
    const select = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('nova');
    await userEvent.selectOptions(select, '');
    expect(screen.queryByRole('link', { name: 'Full voice list' })).toBeNull();
  });
});
