// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecordingConfirmationDialog } from '../src/features/liveAudio/components/audience/RecordingConfirmationDialog';

describe('RecordingConfirmationDialog', () => {
  it('announces explicit recording text and restores focus when cancelled', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Micrófono';
    document.body.appendChild(trigger);
    trigger.focus();
    const onCancel = vi.fn();

    const { unmount } = render(
      <RecordingConfirmationDialog
        pending={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /está siendo grabada/i });
    expect(dialog.getAttribute('aria-describedby')).toBe('recording-confirmation-description');
    expect(screen.getByText(/no controla el sistema externo de grabación/i)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('prevents duplicate confirmation while an ACK is pending', () => {
    render(
      <RecordingConfirmationDialog
        pending
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: /confirmando/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /ahora no/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
