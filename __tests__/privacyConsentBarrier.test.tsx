// @vitest-environment jsdom

import React from 'react';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollapsiblePrivacyNotice } from '../src/features/liveAudio/components/shared/CollapsiblePrivacyNotice';
import { AudienceInterventionModal } from '../src/features/liveAudio/components/audience/AudienceInterventionModal';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubLegalDocuments = () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => ({
    ok: true,
    text: async () => String(input).includes('privacy-summary')
      ? '# Información básica\n\nVersión: summary-1\n\n| Información | Resumen |\n| --- | --- |\n| Responsable | Comunidad |\n| Finalidad | Participación |\n| Legitimación | Base aplicable |\n| Destinatarios | Controles |\n| Derechos | Correo institucional |'
      : '# Política completa\n\nVersión: policy-7\n\nContenido.',
  })));
};

describe('microphone and minor participation barrier', () => {
  it('shows the first-layer table before the full-policy link and keeps its font size inherited', async () => {
    stubLegalDocuments();
    render(<CollapsiblePrivacyNotice externalBroadcastState="recording" onCheckboxesChange={vi.fn()} />);

    const table = await screen.findByRole('table');
    const link = screen.getByRole('link', { name: '/proteccion-datos' });
    expect(table.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.className).toContain('text-inherit');
    expect(await screen.findByText(/versión policy-7; SHA-256 …[a-f0-9]{12}/)).toBeTruthy();
    expect(screen.queryByText(/fuente:/i)).toBeNull();
    expect(screen.queryByText(/mencionar, leer o responder públicamente/i)).toBeNull();
  });

  it('keeps requirements separate and accepts the 14-or-over path without persisting age', async () => {
    stubLegalDocuments();
    const onChange = vi.fn();
    render(<CollapsiblePrivacyNotice externalBroadcastState="recording" onCheckboxesChange={onChange} />);

    await screen.findByRole('table');

    expect(screen.getByText(/evite decir su nombre completo/i)).toBeTruthy();
    expect(screen.getByText(/subtítulos automáticos/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /He leído y comprendido/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo específicamente la activación/i }));
    expect(onChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('radio', { name: /Tengo 14 años o más/i }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Esta selección no se envía ni se conserva/i)).toBeTruthy();
  });

  it('requires a present parent or legal guardian for the under-14 path', async () => {
    stubLegalDocuments();
    const onChange = vi.fn();
    render(<CollapsiblePrivacyNotice externalBroadcastState="recording" onCheckboxesChange={onChange} />);

    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('checkbox', { name: /He leído y comprendido/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo específicamente la activación/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Tengo menos de 14 años/i }));
    expect(onChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole('checkbox', { name: /Mi padre, madre o tutor legal está presente/i }));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('closes without publishing when the participant cancels', () => {
    stubLegalDocuments();
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AudienceInterventionModal
        externalBroadcastState="recording"
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the microphone barrier closed when legal information cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '' })));
    const onChange = vi.fn();
    render(<CollapsiblePrivacyNotice externalBroadcastState="recording" onCheckboxesChange={onChange} />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/permanecerá bloqueada/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /He leído y comprendido/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Autorizo específicamente la activación/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Tengo 14 años o más/i }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
