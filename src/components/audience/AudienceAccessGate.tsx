import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Clock3, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { WebSocketConnectionStatus } from '../../hooks/useWebSocket';
import { usePrivateControlSignals } from '../../hooks/usePrivateControlSignals';
import type { AudienceAccessState } from '../../types/audienceAccess';
import type { LiveAudioExternalBroadcastState } from '../../types/liveAudio';
import { AudienceInterventionModal } from '../../features/liveAudio/components/audience/AudienceInterventionModal';
import welcomeMarkdown from '../../../config/welcome.md?raw';

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
  const [submittedAlias, setSubmittedAlias] = useState<string | null>(null);
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
    if (type === 'LIVE_AUDIO_EXTERNAL_BROADCAST_STATE' && (payload.state === 'off' || payload.state === 'live' || payload.state === 'recording')) {
      setBroadcastState(payload.state);
    } else if (type === 'LIVE_AUDIO_REQUEST_ALIASES' && submittedAlias && privateSignals.ready) {
      void privateSignals.sendPrivateSignal({ type: 'ACCESS_REQUEST', alias: submittedAlias });
    }
  }), [privateSignals, submittedAlias, subscribeToWsMessage]);

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
      if (!aliasSent) throw new Error('No se pudo enviar el alias.');
      setSubmittedAlias(alias);
      const requestSent = wsSend('AUDIENCE_ACCESS_REQUEST', {
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

  return (
    <main className="fixed inset-0 z-[100] bg-slate-950 text-slate-100 overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4 py-12">
        <div className="w-full max-w-md flex flex-col gap-4">
          <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-md flex flex-col items-center text-center gap-6">
            <img src="/logo.svg" alt="Logotipo de la organización" className="h-16 w-auto object-contain" />
            
            {welcomeMarkdown && (
              <div className="max-w-none text-slate-300 text-sm leading-relaxed border-t border-b border-slate-800/80 py-4 w-full text-left [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-2 [&_p]:text-slate-300 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_blockquote]:border-l-2 [&_blockquote]:border-blue-500/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-slate-400 [&_blockquote]:my-3">
                <ReactMarkdown>{welcomeMarkdown}</ReactMarkdown>
              </div>
            )}

            {!mayRequest && (
              <section className="w-full">
                {accessState === 'WAITING' ? (
                  <div role="status" className="flex flex-col items-center gap-2 text-amber-300">
                    <Clock3 className="h-8 w-8 animate-pulse" aria-hidden="true" />
                    <h1 className="text-lg font-bold text-white">Solicitud en espera</h1>
                    <p className="text-xs text-slate-400">El Control principal debe admitirla antes de mostrar la sesión.</p>
                  </div>
                ) : accessState === 'BLOCKED' ? (
                  <div role="alert" className="flex flex-col items-center gap-2 text-red-400">
                    <ShieldAlert className="h-8 w-8" aria-hidden="true" />
                    <h1 className="text-lg font-bold">Acceso bloqueado</h1>
                  </div>
                ) : accessState === 'REJECTED' && retrySeconds > 0 ? (
                  <div role="status" className="flex flex-col items-center gap-2 text-amber-400">
                    <Clock3 className="h-8 w-8" aria-hidden="true" />
                    <p className="text-sm font-medium">Solicitud rechazada. Podrá intentarlo de nuevo en <span className="font-bold">{retrySeconds}</span> segundos.</p>
                  </div>
                ) : (
                  <div role="status" className="flex flex-col items-center gap-2 text-slate-400">
                    <ShieldCheck className="h-8 w-8 text-blue-400 animate-pulse" aria-hidden="true" />
                    <p className="text-xs">Preparando acceso seguro…</p>
                  </div>
                )}
              </section>
            )}
          </div>

          {mayRequest && (
            <AudienceInterventionModal
              dismissible={false}
              inline={true}
              title="Solicitar acceso a la sesión"
              submitLabel={sending ? 'Enviando…' : privateSignals.ready ? 'Solicitar acceso' : 'Preparando cifrado…'}
              submitDisabled={!privateSignals.ready || sending}
              externalBroadcastState={broadcastState}
              onClose={() => {}}
              onSubmit={(alias, visible) => void requestAccess(alias, visible)}
            />
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-[110] -translate-x-1/2 rounded bg-red-950/90 border border-red-800 px-4 py-2 text-sm text-red-200 shadow-xl backdrop-blur-md">
          {error}
        </p>
      )}
    </main>
  );
}
