// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImportExportPanel } from '../src/components/control/ImportExportPanel';
import type { Presentation } from '../src/types/presentation';

describe('ImportExportPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('exports presentations through a Blob URL and revokes it', () => {
    vi.useFakeTimers();
    const presentations = [{ id: 'presentation-1', title: 'Example', slides: [] }] as Presentation[];
    const createObjectUrl = vi.fn(() => 'blob:sefer-export');
    const revokeObjectUrl = vi.fn();
    const click = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectUrl,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);

    render(<ImportExportPanel presentations={presentations} onImport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    const blob = createObjectUrl.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json;charset=utf-8');

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances[0];
    expect(anchor.getAttribute('href')).toBe('blob:sefer-export');
    expect(anchor.getAttribute('download')).toBe('sefer_presenter_presentations.json');

    vi.advanceTimersByTime(100);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:sefer-export');
  });
});
