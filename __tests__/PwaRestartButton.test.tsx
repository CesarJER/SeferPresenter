// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PwaRestartButton } from '../src/components/shared/PwaRestartButton';
import { restartPwaApp } from '../src/utils/pwaUpdate';

vi.mock('../src/utils/pwaUpdate', () => ({
  restartPwaApp: vi.fn().mockResolvedValue(true),
}));

const mockedRestart = vi.mocked(restartPwaApp);

describe('PwaRestartButton', () => {
  beforeEach(() => {
    mockedRestart.mockClear();
  });

  it('shows 4 bars for excellent quality', () => {
    const { container } = render(
      <PwaRestartButton connectionState="connected" connectionQuality="excellent" />
    );

    expect(screen.getByRole('button', { name: 'Conexión excelente. Reiniciar app' })).toBeTruthy();
    expect(container.querySelector('[data-testid="connection-indicator"] svg')?.querySelectorAll('path')).toHaveLength(4);
  });

  it('shows 3 bars for good quality', () => {
    const { container } = render(
      <PwaRestartButton connectionState="connected" connectionQuality="good" />
    );

    expect(screen.getByRole('button', { name: 'Conexión buena. Reiniciar app' })).toBeTruthy();
    expect(container.querySelector('[data-testid="connection-indicator"] svg')?.querySelectorAll('path')).toHaveLength(3);
  });

  it('shows 2 bars for poor quality', () => {
    const { container } = render(
      <PwaRestartButton connectionState="connected" connectionQuality="poor" />
    );

    expect(screen.getByRole('button', { name: 'Conexión pobre. Reiniciar app' })).toBeTruthy();
    expect(container.querySelector('[data-testid="connection-indicator"] svg')?.querySelectorAll('path')).toHaveLength(2);
  });

  it('reconnecting overrides quality', () => {
    const { container } = render(
      <PwaRestartButton connectionState="reconnecting" connectionQuality="excellent" />
    );

    expect(screen.getByRole('button', { name: 'Reconectando audio. Reiniciar app' })).toBeTruthy();
    expect(container.querySelector('[data-testid="connection-indicator"] svg')?.getAttribute('class')).toContain('text-orange-400');
  });

  it('reconnectFailed and disconnected show the failure state', () => {
    const { rerender } = render(
      <PwaRestartButton connectionState="reconnectFailed" connectionQuality="excellent" />
    );

    expect(screen.getByRole('button', { name: 'Audio desconectado. Reiniciar app' })).toBeTruthy();

    rerender(<PwaRestartButton connectionState="disconnected" connectionQuality="excellent" />);
    expect(screen.getByRole('button', { name: 'Audio desconectado. Reiniciar app' })).toBeTruthy();
  });

  it('renders a transient reconnected state', () => {
    const { container } = render(
      <PwaRestartButton connectionState="reconnected" connectionQuality="poor" />
    );

    expect(screen.getByRole('button', { name: 'Audio reconectado. Reiniciar app' })).toBeTruthy();
    expect(container.querySelector('[data-testid="connection-indicator"] svg')?.querySelectorAll('path')).toHaveLength(4);
  });

  it('calls restartPwaApp on click', () => {
    const { container } = render(<PwaRestartButton connectionState="connected" connectionQuality="good" />);

    fireEvent.click(container.querySelector('button')!);

    expect(mockedRestart).toHaveBeenCalledTimes(1);
  });

  it('keeps a visible fallback when quality is unknown', () => {
    const { container } = render(<PwaRestartButton />);

    expect(screen.getByRole('button', { name: 'Conexión desconocida. Reiniciar app' })).toBeTruthy();
    expect(container.querySelector('[data-testid="connection-indicator"] svg')?.querySelectorAll('path')).toHaveLength(4);
  });
});
