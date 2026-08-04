import { useCallback, useEffect, useState } from 'react';
import { Clock3, ShieldAlert } from 'lucide-react';
import type { WebSocketConnectionStatus } from '../../hooks/useWebSocket';
import { usePrivateControlSignals } from '../../hooks/usePrivateControlSignals';
import type { AudienceAccessState } from '../../types/audienceAccess';
import type { LiveAudioExternalBroadcastState } from '../../types/liveAudio';
import { AudienceInterventionModal } from '../../features/liveAudio/components/audience/AudienceInterventionModal';

interface AudienceAccessGateProps {
  accessState: AudienceAccessState;
  participantId: string | null;
  retryAt?: number;
  wsStatus: WebSocketConnectionStatus;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  onAliasAccepted: (alias: string, visible: boolean) => void;
}

export function AudienceAccessGate({
  accessState,
  participantId,
  retryAt,
  wsStatus,
  wsSend,
  subscribeToWsMessage,
  onAliasAccepted,
}: AudienceAccessGateProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [broadcastState, setBroadcastState] = useState<LiveAudioExternalBroadcastState>('off');
  const privateSignals = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId || 'unbound-audience',
    sendMessage: wsSend,
    subscribeToWsMessage,
    transportReady: wsStatus === 'open' && Boolean(participantId),
  });

  useEffect(() => subscribeToWsMessage((type, payload) => {
    if (type !== 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE') return;
    if (payload.state === 'off' || payload.state === 'live' || payload.state === 'recording') {
      setBroadcastState(payload.state);
    }
  }), [subscribeToWsMessage]);

  useEffect(() => {
    if (accessState !== 'REJECTED' || !retryAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [accessState, retryAt]);

  const requestAccess = useCallback(async (alias: string, visible: boolean) => {
    if (!participantId || !privateSignals.ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const aliasSent = await privateSignals.sendPrivateSignal({ type: 'ACCESS_REQUEST', alias });
      const requestSent = aliasSent && wsSend('AUDIENCE_ACCESS_REQUEST', {
        participantId,
        createdAt: Date.now(),
      });
      if (!requestSent) throw new Error('No se pudo enviar la solicitud.');
      onAliasAccepted(alias, visible);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo enviar la solicitud.');
    } finally {
      setSending(false);
    }
  }, [onAliasAccepted, participantId, privateSignals, sending, wsSend]);

  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const mayRequest = accessState === 'REQUEST_REQUIRED' || (accessState === 'REJECTED' && retrySeconds === 0);

  if (mayRequest) {
    return (
      <>
        <AudienceInterventionModal
          dismissible={false}
          title="Solicitar acceso a la sesión"
          submitLabel={sending ? 'Enviando…' : privateSignals.ready ? 'Solicitar acceso' : 'Preparando cifrado…'}
          submitDisabled={!privateSignals.ready || sending}
          externalBroadcastState={broadcastState}
          onClose={() => {}}
          onSubmit={(alias, visible) => void requestAccess(alias, visible)}
        />
        {error && <p role="alert" className="fixed bottom-4 left-1/2 z-[110] -translate-x-1/2 rounded bg-red-950 px-4 py-2 text-sm text-red-200">{error}</p>}
      </>
    );
  }

  return (
    <main className="fixed inset-0 z-[100] grid place-items-center bg-slate-950 p-4 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        {accessState === 'WAITING' ? (
          <div role="status" className="space-y-3">
            <Clock3 className="h-8 w-8 text-amber-300" aria-hidden="true" />
            <h1 className="text-xl font-bold">Solicitud en espera</h1>
            <p className="text-sm text-slate-300">El Control principal debe admitirla antes de mostrar la sesión.</p>
          </div>
        ) : accessState === 'BLOCKED' ? (
          <div role="alert" className="space-y-3 text-red-200">
            <ShieldAlert className="h-8 w-8" aria-hidden="true" />
            <h1 className="text-xl font-bold">Acceso bloqueado</h1>
          </div>
        ) : accessState === 'REJECTED' ? (
          <p role="status">Solicitud rechazada. Podrá intentarlo de nuevo en {retrySeconds} segundos.</p>
        ) : (
          <p role="status">Preparando acceso seguro…</p>
        )}
      </section>
    </main>
  );
}
