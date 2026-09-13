// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudienceAccessGate } from '../src/components/audience/AudienceAccessGate';

const sendPrivateSignal = vi.fn(async () => true);

vi.mock('../src/hooks/usePrivateControlSignals', () => ({
  usePrivateControlSignals: () => ({ ready: true, sendPrivateSignal }),
}));

vi.mock('../src/features/liveAudio/components/audience/AudienceInterventionModal', () => ({
  AudienceInterventionModal: () => <div data-testid="alias-form" />,
}));

vi.mock('../src/components/shared/BrandingWelcome', () => ({ BrandingWelcome: () => null }));

describe('AudienceAccessGate TV mode', () => {
  const wsSend = vi.fn(() => true);
  const onAliasAccepted = vi.fn();
  const subscribeToWsMessage = vi.fn(() => () => {});
  const baseProps = {
    participantId: 'participant-tv',
    retryAt: undefined,
    wsStatus: 'open' as const,
    wsSend,
    subscribeToWsMessage,
    onAliasAccepted,
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('uses the normal manual form without autoAlias', () => {
    render(<AudienceAccessGate {...baseProps} accessState="REQUEST_REQUIRED" />);
    expect(screen.getByTestId('alias-form')).toBeTruthy();
    expect(sendPrivateSignal).not.toHaveBeenCalled();
  });

  it('sends alias TV privately and one ordinary access request', async () => {
    const { rerender } = render(
      <AudienceAccessGate {...baseProps} accessState="REQUEST_REQUIRED" autoAlias="TV" />,
    );
    expect(screen.queryByTestId('alias-form')).toBeNull();
    await waitFor(() => expect(wsSend).toHaveBeenCalledTimes(1));
    expect(sendPrivateSignal).toHaveBeenCalledWith({ type: 'ACCESS_REQUEST', alias: 'TV' });
    expect(wsSend).toHaveBeenCalledWith('AUDIENCE_ACCESS_REQUEST', expect.objectContaining({ participantId: 'participant-tv' }));
    expect(onAliasAccepted).toHaveBeenCalledWith('TV', false);

    rerender(<AudienceAccessGate {...baseProps} accessState="REQUEST_REQUIRED" autoAlias="TV" />);
    rerender(<AudienceAccessGate {...baseProps} accessState="WAITING" autoAlias="TV" />);
    rerender(<AudienceAccessGate {...baseProps} accessState="WAITING" autoAlias="TV" wsStatus="closed" />);
    rerender(<AudienceAccessGate {...baseProps} accessState="WAITING" autoAlias="TV" wsStatus="open" />);
    expect(wsSend).toHaveBeenCalledTimes(1);
  });

  it.each(['ADMITTED', 'REJECTED', 'BLOCKED'] as const)('does not auto-request in %s', async (accessState) => {
    render(<AudienceAccessGate {...baseProps} accessState={accessState} autoAlias="TV" />);
    await Promise.resolve();
    expect(wsSend).not.toHaveBeenCalled();
  });

  it('may request once for a new participant identity', async () => {
    const { rerender } = render(<AudienceAccessGate {...baseProps} accessState="REQUEST_REQUIRED" autoAlias="TV" />);
    await waitFor(() => expect(wsSend).toHaveBeenCalledTimes(1));
    rerender(<AudienceAccessGate {...baseProps} participantId="participant-new-session" accessState="REQUEST_REQUIRED" autoAlias="TV" />);
    await waitFor(() => expect(wsSend).toHaveBeenCalledTimes(2));
  });
});
