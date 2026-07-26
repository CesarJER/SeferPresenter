// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { CustomSearchSelect } from '../../src/components/shared/CustomSearchSelect';
import { AudienceInterventionModal } from '../../src/features/liveAudio/components/audience/AudienceInterventionModal';
import { AudiencePrivateControlMessage } from '../../src/features/liveAudio/components/audience/AudiencePrivateControlMessage';
import { PrivateControlInbox } from '../../src/features/liveAudio/components/control/PrivateControlInbox';

vi.mock('../../src/features/liveAudio/hooks/useLiveAudioAvailability', () => ({
  useLiveAudioAvailability: () => ({ availability: 'available' }),
}));

afterEach(() => cleanup());

describe('accessible composite controls', () => {
  it('exposes select state and supports keyboard navigation and selection', async () => {
    const onChange = vi.fn();
    render(
      <CustomSearchSelect
        value="one"
        onChange={onChange}
        options={[
          { label: 'Uno', value: 'one' },
          { label: 'Dos', value: 'two' },
        ]}
        ariaLabel="Fondo de diapositiva"
      />
    );

    const trigger = screen.getByRole('combobox', { name: 'Fondo de diapositiva' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const search = screen.getByRole('textbox', { name: 'Buscar en Fondo de diapositiva' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.keyDown(search, { key: 'ArrowDown' });

    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('two');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe('accessible audience dialogs', () => {
  it('labels intervention as modal, closes with Escape, and restores focus', async () => {
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Abrir intervencion</button>
          {open && (
            <AudienceInterventionModal
              onClose={() => setOpen(false)}
              onSubmit={vi.fn()}
            />
          )}
        </>
      );
    };
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir intervencion' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: /Participar en la Reuni/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Participar en la Reuni/i }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('focuses the private message field and confines forward Tab focus', () => {
    render(<AudiencePrivateControlMessage onClose={vi.fn()} onSend={vi.fn(() => true)} />);

    const dialog = screen.getByRole('dialog', { name: 'Mensaje a Control' });
    const textarea = screen.getByRole('textbox', { name: 'Mensaje privado para Control' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(textarea);

    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar mensaje privado' }));
  });
});

describe('focus-visible actions', () => {
  it('reveals the private inbox dismiss action on keyboard focus', () => {
    render(
      <PrivateControlInbox
        isOpen
        isControlAuthorized
        messages={[{ id: 'message-1', fromAlias: 'Visitante', content: 'Hola', timestamp: 1 }]}
        authorizationRequests={[]}
        onApproveRequest={vi.fn()}
        onRejectRequest={vi.fn()}
        onDismissMessage={vi.fn()}
      />
    );

    const dismiss = screen.getByRole('button', { name: 'Descartar mensaje de Visitante' });
    expect(dismiss.className).toContain('focus-visible:opacity-100');
  });
});
