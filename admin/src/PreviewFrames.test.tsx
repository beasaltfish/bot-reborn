import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { PreviewFrames } from './PreviewFrames';

describe('PreviewFrames', () => {
  it('cycles the frames it is given', () => {
    vi.useFakeTimers();
    try {
      render(<PreviewFrames frames={['/a.jpg', '/b.jpg']} alt="Pet" />);
      expect(screen.getByRole('img')).toHaveAttribute('src', '/a.jpg');
      act(() => { vi.advanceTimersByTime(1200); });
      expect(screen.getByRole('img')).toHaveAttribute('src', '/b.jpg');
      act(() => { vi.advanceTimersByTime(1200); });
      expect(screen.getByRole('img')).toHaveAttribute('src', '/a.jpg');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind when the tab goes away', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(<PreviewFrames frames={['/a.jpg', '/b.jpg']} alt="Pet" />);
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one frame is a picture, not a slideshow', () => {
    vi.useFakeTimers();
    try {
      render(<PreviewFrames frames={['/only.jpg']} alt="Car" />);
      expect(vi.getTimerCount()).toBe(0);
      expect(screen.getByRole('img')).toHaveAttribute('src', '/only.jpg');
    } finally {
      vi.useRealTimers();
    }
  });
});
