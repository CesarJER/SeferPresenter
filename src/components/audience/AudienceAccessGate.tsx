import { useCallback, useEffect, useState } from 'react';
import { Clock3, LockKeyhole, ShieldAlert } from 'lucide-react';
import { usePrivateControlSignals } from '../../hooks/usePrivateControlSignals';
import type { AudienceAccessState } from '../../types/audienceAccess';
import type { WebSocketConnectionStatus } from '../../hooks/useWebSocket';
import { DataProtectionLink } from '../shared/DataProtectionLink';

interface AudienceAccessGateProps {
  accessState: AudienceAccessState;
  participantId: string | null;
  retryAt?: number;
  wsStatus: WebSocketConnectionStatus;
  wsSend: (type: string, payload?: unknown) => boolean;
  subscribeToWsMessage: (
    handler: (type: string, payload: Record<string, unknown>) => void,
  ) => () => void;
  onAliasAccepted: (alias: string) => void;
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
  const [alias, setAlias] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const privateSignals = usePrivateControlSignals({
    role: 'audience',
    participantId: participantId || 'unbound-audience',
    sendMessage: wsSend,
    subscribeToWsMessage,
    transportReady: wsStatus === 'open' && Boolean(participantId),
  });

  const requestAccess = useCallback(async () => {
    const safeAlias = alias.trim().replace(/\s+/gu, ' ').normalize('NFC').slice(0, 50);
    if (!participantId || !safeAlias || !privateSignals.ready) return;
    setSending(true);
    setError(null);
    try {
      const aliasSent = await privateSignals.sendPrivateSignal({
        type: 'ACCESS_REQUEST',
        alias: safeAlias,
      });
      const requestSent = aliasSent && wsSend('AUDIENCE_ACCESS_REQUEST', {
        participantId,
        createdAt: Date.now(),
      });
      if (!requestSent) throw new Error('No se pudo enviar la solicitud.');
      onAliasAccepted(safeAlias);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo enviar la solicitud.');
    } finally {
      setSending(false);
    }
  }, [alias, onAliasAccepted, participantId, privateSignals, wsSend]);

  useEffect(() => {
    if (accessState !== 'REJECTED' || !retryAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [accessState, retryAt]);

  const retrySeconds = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const mayRequest = accessState === 'REQUEST_REQUIRED' ||
    (accessState === 'REJECTED' && retrySeconds === 0);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section
        className="mx-auto max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        aria-labelledby="audience-access-title"
      >
        <div className="mb-5 flex items-center gap-3">
          <LockKeyhole className="h-7 w-7 text-blue-300" aria-hidden="true" />
          <h1 id="audience-access-title" className="text-xl font-bold">Acceso controlado</h1>
        </div>

        {accessState === 'WAITING' && (
          <div role="status" className="space-y-3 text-slate-200">
            <Clock3 className="h-8 w-8 text-amber-300" aria-hidden="true" />
            <p className="font-semibold">Tu solicitud está en la sala de espera.</p>
            <p className="text-sm text-slate-400">Un usuario Control debe admitirla antes de mostrar el contenido de la sesión.</p>
          </div>
        )}

        {(accessState === 'LOADING' || accessState === 'ADMITTED') && (
          <p role="status" className="text-sm text-slate-300">Preparando una sesión segura…</p>
        )}

        {accessState === 'CREDENTIAL_OBSOLETE' && (
          <p role="alert" className="text-sm text-red-300">La credencial de esta sesión ya no es válida. Reintentando…</p>
        )}

        {accessState === 'BLOCKED' && (
          <div role="alert" className="space-y-3 text-red-200">
            <ShieldAlert className="h-8 w-8" aria-hidden="true" />
            <p className="font-semibold">El acceso está bloqueado durante esta sesión.</p>
          </div>
        )}

        {accessState === 'REJECTED' && retrySeconds > 0 && (
          <div className="rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
            <p role="status">La solicitud fue rechazada. Podrás corregir el alias y repetirla cuando finalice la espera.</p>
            <p aria-hidden="true" className="mt-1 text-xs">Disponible en {retrySeconds} segundos.</p>
          </div>
        )}

        {mayRequest && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void requestAccess();
            }}
          >
            <p className="text-sm text-slate-300">
              Introduce un alias. La aprobación modera el acceso, pero no verifica tu identidad real.
            </p>
            <label className="block space-y-2">
              <span className="text-sm font-semibold">Alias</span>
              <input
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                maxLength={50}
                autoComplete="nickname"
                className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"
              />
            </label>
            <button
              type="submit"
              disabled={!alias.trim() || !privateSignals.ready || sending}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? 'Enviando…' : privateSignals.ready ? 'Solicitar acceso' : 'Preparando cifrado…'}
            </button>
          </form>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
        <DataProtectionLink className="mt-6 inline-flex text-xs text-blue-300 underline" />
      </section>
    </main>
  );
}
