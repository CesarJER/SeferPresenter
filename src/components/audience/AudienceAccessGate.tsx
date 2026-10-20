import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, ShieldAlert, ShieldCheck, MessageSquare, X } from 'lucide-react';
import type { WebSocketConnectionStatus } from '../../hooks/useWebSocket';
import { usePrivateControlSignals, type DecryptedPrivateControlSignal } from '../../hooks/usePrivateControlSignals';
import type { AudienceAccessState } from '../../types/audienceAccess';
import type { LiveAudioExternalBroadcastState } from '../../types/liveAudio';
import { AudienceInterventionModal } from '../../features/liveAudio/components/audience/AudienceInterventionModal';
import { AudiencePrivateControlMessage } from '../../features/liveAudio/components/audience/AudiencePrivateControlMessage';
import { BrandingWelcome } from '../shared/BrandingWelcome';
import { applyNeutralBrandingFallback } from '../../utils/branding';

interface AudienceAccessGateProps {
  accessState: AudienceAccessState;
  participantId: string | null;
  retryAt?: number;
  wsStatus: WebSocketConnectionStatus;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
  onAliasAccepted: (alias: string, visible: boolean) => void;
  autoAlias?: string;
}

export function AudienceAccessGate({
  accessState,
  participantId,
  retryAt,
  wsStatus,
  wsSend,
  subscribeToWsMessage,
  onAliasAccepted,
  autoAlias,
}: AudienceAccessGateProps) {
  useUiTranslation('audience');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedAlias, setSubmittedAlias] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [broadcastState, setBroadcastState] = useState<LiveAudioExternalBroadcastState>('off');
  const [showPrivateMessageModal, setShowPrivateMessageModal] = useState(false);
  const [receivedControlMessages, setReceivedControlMessages] = useState<
    Array<{ id: string; senderNick: string; text: string; timestamp: number }>
  >([]);
  const autoRequestedParticipantRef = useRef<string | null>(null);

  const handlePrivateSignal = useCallback((signal: DecryptedPrivateControlSignal) => {
    const payload = signal.value as Record<string, unknown>;
    if (payload && typeof payload === 'object' && payload.type === 'CHAT_RESPONSE') {
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const senderNick = typeof payload.senderNick === 'string' && payload.senderNick ? payload.senderNick : 'Control';
      const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
      if (text) {
        setReceivedControlMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            senderNick,
            text,
            timestamp,
          },
        ]);
      }
    }
  }, []);

  const privateSignals = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId || 'unbound-audience',
    sendMessage: wsSend,
    subscribeToWsMessage,
    transportReady: wsStatus === 'open' && Boolean(participantId),
    onPrivateSignal: handlePrivateSignal,
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
      if (!aliasSent) throw new Error(translate("audience:AudienceAccessGate.couldNotSendTheAlias", "No se pudo enviar el alias."));
      setSubmittedAlias(alias);
      const requestSent = wsSend('AUDIENCE_ACCESS_REQUEST', {
        participantId,
        createdAt: Date.now(),
      });
      if (!requestSent) throw new Error(translate("audience:AudienceAccessGate.couldNotSendTheRequest", "No se pudo enviar la solicitud."));
      onAliasAccepted(alias, visible);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : translate("audience:AudienceAccessGate.couldNotSendTheRequest", "No se pudo enviar la solicitud."));
    } finally {
      setSending(false);
    }
  }, [onAliasAccepted, participantId, privateSignals, sending, wsSend]);

  useEffect(() => {
    if (!autoAlias || accessState !== 'REQUEST_REQUIRED' || !participantId || !privateSignals.ready) return;
    if (autoRequestedParticipantRef.current === participantId) return;
    autoRequestedParticipantRef.current = participantId;
    void requestAccess(autoAlias, false);
  }, [accessState, autoAlias, participantId, privateSignals.ready, requestAccess]);

  const handleSendPrivateMessage = useCallback(async (messageText: string): Promise<boolean> => {
    if (!participantId || !privateSignals.ready) return false;
    return privateSignals.sendPrivateSignal({
      type: 'PRIVATE_MESSAGE',
      text: messageText,
      alias: submittedAlias || translate("audience:AudienceAccessGate.waiting", "En espera"),
    });
  }, [participantId, privateSignals, submittedAlias]);

  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const mayRequest = accessState === 'REQUEST_REQUIRED' || (accessState === 'REJECTED' && retrySeconds === 0);
  const showManualRequest = mayRequest && !autoAlias;

  return (
    <main className="fixed inset-0 z-100 bg-slate-950 text-slate-100 overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4 py-12">
        <div className="w-full max-w-md flex flex-col gap-4">
          <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-md flex flex-col items-center text-center gap-6">
            <img
              src="/api/branding/logo.svg"
              alt={translate("audience:AudienceAccessGate.organizationLogo", "Logotipo de la organización")}
              className="h-16 w-auto object-contain"
              onError={applyNeutralBrandingFallback}
            />
            
            <BrandingWelcome />

            {!showManualRequest && (
              <section className="w-full flex flex-col items-center">
                {accessState === 'WAITING' ? (
                  <div role="status" className="flex flex-col items-center gap-2 text-amber-300 w-full">
                    <Clock3 className="h-8 w-8 animate-pulse" aria-hidden="true" />
                    <h1 className="text-lg font-bold text-white">{translate("audience:AudienceAccessGate.requestPending", "Solicitud en espera")}</h1>
                    <p className="text-xs text-slate-400">{translate("audience:AudienceAccessGate.theMainControlMustAdmitYouBeforeTheSession", "El Control principal debe admitirla antes de mostrar la sesión.")}</p>

                    <button
                      type="button"
                      onClick={() => setShowPrivateMessageModal(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 hover:bg-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white transition-colors shadow-xs"
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                      <span>{translate("audience:AudienceAccessGate.sendAMessageToTheModerators", "Enviar mensaje a los moderadores")}</span>
                    </button>

                    {/* Received Messages from Control */}
                    {receivedControlMessages.length > 0 && (
                      <div className="w-full mt-4 space-y-2 text-start">
                        {receivedControlMessages.map((msg) => (
                          <div
                            key={msg.id}
                            className="rounded-xl border border-blue-600/40 bg-blue-950/60 p-3 shadow-lg backdrop-blur-xs"
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
                                <MessageSquare className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                <span>{translate("audience:AudienceAccessGate.messageFrom", "Mensaje de")} {msg.senderNick}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setReceivedControlMessages((prev) => prev.filter((m) => m.id !== msg.id))}
                                  className="text-slate-400 hover:text-white p-0.5 rounded-sm transition-colors"
                                  title={translate("audience:AudienceAccessGate.closeMessage", "Cerrar mensaje")}
                                  aria-label={translate("audience:AudienceAccessGate.closeMessage", "Cerrar mensaje")}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-slate-100 leading-relaxed ps-5">
                              "{msg.text}"
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : accessState === 'BLOCKED' ? (
                  <div role="alert" className="flex flex-col items-center gap-2 text-red-400">
                    <ShieldAlert className="h-8 w-8" aria-hidden="true" />
                    <h1 className="text-lg font-bold">{translate("audience:AudienceAccessGate.accessBlocked", "Acceso bloqueado")}</h1>
                  </div>
                ) : accessState === 'REJECTED' && retrySeconds > 0 ? (
                  <div role="status" className="flex flex-col items-center gap-2 text-amber-400">
                    <Clock3 className="h-8 w-8" aria-hidden="true" />
                    <p className="text-sm font-medium">{translate("audience:AudienceAccessGate.requestRejectedYouCanTryAgainIn", "Solicitud rechazada. Podrá intentarlo de nuevo en")} <span className="font-bold">{retrySeconds}</span>  {translate("audience:AudienceAccessGate.seconds", "segundos.")}</p>
                  </div>
                ) : (
                  <div role="status" className="flex flex-col items-center gap-2 text-slate-400">
                    <ShieldCheck className="h-8 w-8 text-blue-400 animate-pulse" aria-hidden="true" />
                    <p className="text-xs">{translate("audience:AudienceAccessGate.preparingSecureAccess", "Preparando acceso seguro…")}</p>
                  </div>
                )}
              </section>
            )}
          </div>

          {showManualRequest && (
            <AudienceInterventionModal
              dismissible={false}
              inline={true}
              title={translate("audience:AudienceAccessGate.requestAccessToTheSession", "Solicitar acceso a la sesión")}
              submitLabel={sending ? 'Enviando…' : privateSignals.ready ? 'Solicitar acceso' : 'Preparando cifrado…'}
              submitDisabled={!privateSignals.ready || sending}
              externalBroadcastState={broadcastState}
              onClose={() => {}}
              onSubmit={(alias, visible) => void requestAccess(alias, visible)}
            />
          )}
        </div>
      </div>

      {showPrivateMessageModal && (
        <AudiencePrivateControlMessage
          onClose={() => setShowPrivateMessageModal(false)}
          onSend={handleSendPrivateMessage}
        />
      )}

      {error && (
        <p role="alert" className="fixed bottom-4 left-1/2 z-110 -translate-x-1/2 rounded-sm bg-red-950/90 border border-red-800 px-4 py-2 text-sm text-red-200 shadow-xl backdrop-blur-md">
          {error}
        </p>
      )}
    </main>
  );
}
