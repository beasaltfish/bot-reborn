import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SetupCard } from './SetupCard';
import { setupSteps } from './setup';
import type { Summary } from './types';

function stepsFor(overrides: Partial<Summary> = {}) {
  const current: Summary = { id: 'a', name: 'Asten', ready: false, online: false, motion: 'pet', ...overrides };
  return setupSteps({ characters: [current], current, board: null });
}

describe('SetupCard', () => {
  it('shows the five ordered steps with state, action, source and the next step', () => {
    const steps = stepsFor();
    render(<SetupCard steps={steps} next={steps[1]} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.dataset.step)).toEqual(['character', 'keys', 'body-screen', 'board', 'first-words']);
    expect(within(rows[0]).getByText('Done')).toBeVisible();
    expect(within(rows[0]).getByText('From this brain')).toBeVisible();
    expect(rows[1]).toHaveAttribute('aria-current', 'step');
    expect(within(rows[1]).getByText('Add three keys')).toBeVisible();
    expect(within(rows[1]).getByText(/Ears.*Mind.*Voice/)).toBeVisible();
    expect(within(rows[1]).getByText('To do')).toBeVisible();
    expect(within(rows[2]).getByText(/Basic.*Body.*Set up a board/)).toBeVisible();
    expect(within(rows[3]).getByText(/First time \(flash \+ settings\)/)).toBeVisible();
    expect(within(rows[4]).getByText(/wake word/i)).toBeVisible();
    expect(within(rows[4]).getByText('Not recorded')).toBeVisible();
    expect(screen.getByText(/since this brain started/i)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Next: Add three keys');
  });

  it('shows the skipped row but excludes it from phone progress', () => {
    const steps = stepsFor({ motion: 'none', ready: true, lastSeenAt: 1 });
    render(<SetupCard steps={steps} next={steps[4]} />);

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[2]).getByText(/Basic.*QR code.*Phone/)).toBeVisible();
    expect(within(rows[3]).getByText('Skipped')).toBeVisible();
    expect(within(rows[3]).getByText(/phone does not need/i)).toBeVisible();
    expect(within(rows[3]).getByText('Not recorded')).toBeVisible();
    expect(screen.getByText('3 of 4 complete')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Next: Hear the first reply');
  });

  it('starts collapsed when all required phone steps are complete and can be reopened', async () => {
    const steps = stepsFor({ motion: 'dry-run', ready: true, lastSeenAt: 1, lastSpokeAt: 2 });
    render(<SetupCard steps={steps} next={null} />);

    const summary = screen.getByText('Setup complete', { selector: 'summary' });
    const disclosure = summary.closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    await userEvent.click(summary);
    expect(disclosure).toHaveAttribute('open');
    expect(screen.getByRole('list')).toBeVisible();
    expect(screen.getByText('Skipped')).toBeVisible();
    expect(screen.queryByText(/Next:/)).not.toBeInTheDocument();
  });

  it('shows Chinese titles, guidance, states, and all three sources', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => key === 'botreborn.adminLang' ? 'zh' : null);
    vi.resetModules();
    const { SetupCard: ChineseSetupCard } = await import('./SetupCard');
    const current: Summary = { id: 'a', name: 'Asten', ready: false, online: false, motion: 'pet' };
    const steps = setupSteps({ characters: [current], current, board: { characterId: 'a', screen: null, flashedAt: 1 } });
    const view = render(<ChineseSetupCard steps={steps} next={steps[1]} />);

    expect(screen.getByRole('heading', { name: '首次设置' })).toBeVisible();
    const rows = screen.getAllByRole('listitem');
    const copy = [
      ['创建角色', /先给机器人创建一个角色/, '来自这个大脑'],
      ['填入三把密钥', /「听」「想」「说」/, '来自这个大脑'],
      ['选身体与屏幕', /「基本」.*「配置板子」/, '记在此浏览器'],
      ['刷写板子', /「第一次（刷固件 \+ 设置）」/, '记在此浏览器'],
      ['听到第一句回复', /唤醒词/, '暂无记录'],
    ] as const;
    rows.forEach((row, index) => {
      const [title, note, source] = copy[index];
      expect(within(row).getByText(title)).toBeVisible();
      expect(within(row).getByText(note)).toBeVisible();
      expect(within(row).getByText(source)).toBeVisible();
    });
    expect(screen.getByText(/本次启动以来/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('下一步：填入三把密钥');

    const phone = stepsFor({ motion: 'none', ready: true, lastSeenAt: 1 });
    view.rerender(<ChineseSetupCard steps={phone} next={phone[4]} />);
    expect(screen.getByText(/扫描「手机」区的二维码/)).toBeVisible();
    expect(screen.getByText('已跳过')).toBeVisible();
    expect(screen.getByText(/不需要板子，也不用刷固件/)).toBeVisible();
    expect(screen.getByText('已完成 3 / 4 步')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('下一步：听到第一句回复');
  });
});
