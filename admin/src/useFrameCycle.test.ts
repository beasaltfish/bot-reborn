import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFrameCycle } from './useFrameCycle';

describe('useFrameCycle', () => {
  it('walks the frames it is given', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFrameCycle(['/a.jpg', '/b.jpg']));
      expect(result.current).toBe('/a.jpg');
      act(() => { vi.advanceTimersByTime(1200); });
      expect(result.current).toBe('/b.jpg');
      act(() => { vi.advanceTimersByTime(1200); });
      expect(result.current).toBe('/a.jpg');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves no timer behind when the tab goes away', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useFrameCycle(['/a.jpg', '/b.jpg']));
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one frame is a picture, not a slideshow; none is null', () => {
    vi.useFakeTimers();
    try {
      expect(renderHook(() => useFrameCycle(['/only.jpg'])).result.current).toBe('/only.jpg');
      expect(vi.getTimerCount()).toBe(0);
      expect(renderHook(() => useFrameCycle([])).result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
