import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  MessageSquare,
  KeyRound,
  Check,
  Trash2,
  ShieldAlert,
  User,
  UserCheck,
  UserX,
  Send,
  CornerDownRight,
  Sparkles,
} from 'lucide-react';
import type { PendingControlAuthorization } from '../../../../types/liveAudio';
import { AudioDeviceSettings } from './AudioDeviceSettings';

export interface ConversationRecipient {
  participantId: string;
  alias: string;
  eligible: boolean;
}

export interface MessageReply {
  replyId: string;
  responseText: string;
  repliedBy: string;
  repliedAt: number;
  audienceQueued: boolean;
}

export interface PrivateReplyResult {
  audienceQueued: boolean;
  controlsQueued: boolean;
  operationId?: string;
}

export interface PrivateMessage {
  id: string;
  fromAlias: string;
  content: string;
  timestamp: number;
  fromParticipantId?: string;
  ephemeralPublicKey?: string;
  keyId?: string;
  replyTo?: string;
  isWaitingRoom?: boolean;
  isInterControl?: boolean;
  replies?: MessageReply[];
  isControlToAudience?: boolean;
  toAlias?: string;
  toParticipantId?: string;
  audienceQueued?: boolean;
  controlsQueued?: boolean;
}

export interface AudienceAccessRequestItem {
  participantId: string;
  alias: string;
  requestedAt: number;
  accessState: 'WAITING' | 'BLOCKED';
}

interface PrivateControlInboxProps {
  mediaAvailable?: boolean;
  conversationRecipients?: ConversationRecipient[];
  onSendConversation?: (participantId: string, text: string) => Promise<PrivateReplyResult>;
  programAudioEnabled?: boolean;
  onProgramAudioEnabledChange?: (enabled: boolean) => void;
  isOpen: boolean;
  isControlAuthorized: boolean;
  messages: PrivateMessage[];
  authorizationRequests: PendingControlAuthorization[];
  audienceAccessRequests?: AudienceAccessRequestItem[];
  onApproveRequest: (sessionId: string) => void;
  onRejectRequest: (sessionId: string) => void;
  onDismissMessage: (id: string) => void;
  onAudienceAccessDecision?: (participantId: string, decision: 'ADMIT' | 'REJECT' | 'BLOCK' | 'UNBLOCK') => void;
  onReplyToParticipant?: (messageId: string, participantId: string, text: string) => Promise<PrivateReplyResult>;
  onSendInterControlMessage?: (text: string) => Promise<boolean>;
  onOperatorNickChange?: (nick: string) => void;
  presentationSessionId?: string | null;
  keyId?: string | null;
}

const formatTime = (timestamp: number): string => {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export const PrivateControlInbox: React.FC<PrivateControlInboxProps> = ({
  mediaAvailable = false, conversationRecipients = [], onSendConversation,
  programAudioEnabled,
  onProgramAudioEnabledChange,
  isOpen,
  isControlAuthorized,
  messages,
  authorizationRequests,
  audienceAccessRequests = [],
  onApproveRequest,
  onRejectRequest,
  onDismissMessage,
  onAudienceAccessDecision = () => {},
  onReplyToParticipant,
  onSendInterControlMessage,
  onOperatorNickChange,
  presentationSessionId,
  keyId,
}) => {
  useUiTranslation('liveAudio');

  const [operatorNick, setOperatorNick] = useState<string>(
    () => localStorage.getItem('sefer_control_operator_nick') || '',
  );
  const [isNickPublic, setIsNickPublic] = useState<boolean>(
    () => localStorage.getItem('sefer_control_nick_public') === 'true',
  );

  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyResults, setReplyResults] = useState<Record<string, PrivateReplyResult>>({});
  const [selectedRecipient, setSelectedRecipient] = useState<string>('control');
  const [composerText, setComposerText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const composerRevisionRef = useRef(0);
  const composerDraftRef = useRef({ text: '', recipient: 'control' });
  composerDraftRef.current = { text: composerText, recipient: selectedRecipient };
  const lifecycleRef = useRef({ isControlAuthorized, presentationSessionId, keyId });
  lifecycleRef.current = { isControlAuthorized, presentationSessionId, keyId };
  const isMountedRef = useRef(true);
  const pendingReplies = useRef(new Set<string>());

  useEffect(() => {
    composerRevisionRef.current += 1;
  }, [isControlAuthorized, presentationSessionId, keyId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      composerRevisionRef.current += 1;
    };
  }, []);

  if (!isOpen) return null;

  if (!isControlAuthorized) {
    return (
      <div className="fixed top-16 end-0 md:end-4 w-full md:w-[400px] bg-gray-900 border border-red-800 md:rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="p-3 bg-red-900/50 flex items-center justify-between">
          <h3 className="font-bold text-red-200 text-sm">{translate("liveAudio:PrivateControlInbox.accessDenied", "Acceso Denegado")}</h3>
        </div>
        <div className="p-4 text-sm text-gray-400">
          {translate("liveAudio:PrivateControlInbox.youAreNotAnAuthorizedControlYouCannotAccess", "No eres un Control Autorizado. No tienes acceso a la bandeja privada ni a los alias descifrados.")}</div>
      </div>
    );
  }

  const pendingAccessRequests = audienceAccessRequests.filter(
    (req) => req.accessState === 'WAITING',
  );
  const blockedAccessRequests = audienceAccessRequests.filter(
    (req) => req.accessState === 'BLOCKED',
  );

  const hasItems =
    messages.length > 0 ||
    authorizationRequests.length > 0 ||
    pendingAccessRequests.length > 0 ||
    blockedAccessRequests.length > 0;

  const handleOperatorNickChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setOperatorNick(value);
    localStorage.setItem('sefer_control_operator_nick', value);
    onOperatorNickChange?.(value);
  };

  const handleToggleNickPublic = () => {
    setIsNickPublic((prev) => {
      const next = !prev;
      localStorage.setItem('sefer_control_nick_public', String(next));
      return next;
    });
  };

  const handleSendReply = async (replyId: string, participantId: string, text = (replyDrafts[replyId] || '').trim()) => {
    if (!text || !onReplyToParticipant || pendingReplies.current.has(replyId)) return;
    pendingReplies.current.add(replyId);
    try {
      const result = await onReplyToParticipant(replyId, participantId, text);
      setReplyResults(previous => ({ ...previous, [replyId]: result }));
      if (result.audienceQueued) {
        setReplyDrafts((prev) => ({ ...prev, [replyId]: '' }));
        setActiveReplyId(null);
      }
    } catch {
      setReplyResults(previous => ({ ...previous, [replyId]: { audienceQueued: false, controlsQueued: false } }));
    } finally {
      pendingReplies.current.delete(replyId);
    }
  };

  const handleQuickThank = (msg: PrivateMessage) => {
    if (!msg.fromParticipantId || !onReplyToParticipant) return;
    const thankText = msg.fromAlias && msg.fromAlias !== 'Sin nick' ? `Gracias, ${msg.fromAlias}` : 'Gracias';
    void handleSendReply(msg.id, msg.fromParticipantId, thankText);
  };

  const isSelectedRecipientEligible = selectedRecipient === 'control'
    || Boolean(conversationRecipients.find((r) => r.participantId === selectedRecipient)?.eligible);
  const selectedRecipientAlias = conversationRecipients.find((r) => r.participantId === selectedRecipient)?.alias || '';

  const handleSendFromComposer = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = composerText.trim();
    if (!text || isSending || !isSelectedRecipientEligible) return;

    if (selectedRecipient === 'control') {
      if (!onSendInterControlMessage) return;
      setIsSending(true);
      setSendError(null);
      const sendRevision = ++composerRevisionRef.current;
      const sendLifecycle = { ...lifecycleRef.current };
      const targetText = text;

      try {
        const ok = await onSendInterControlMessage(text);
        if (
          isMountedRef.current &&
          composerRevisionRef.current === sendRevision &&
          lifecycleRef.current.isControlAuthorized &&
          lifecycleRef.current.presentationSessionId === sendLifecycle.presentationSessionId &&
          lifecycleRef.current.keyId === sendLifecycle.keyId &&
          composerDraftRef.current.recipient === 'control' &&
          composerDraftRef.current.text.trim() === targetText
        ) {
          if (ok === true) {
            setComposerText('');
            composerDraftRef.current.text = '';
            setSendError(null);
          } else {
            setSendError(translate('liveAudio:Conversations.couldNotSend', 'No se pudo preparar o enviar el mensaje. El borrador se conserva.'));
          }
        }
      } catch {
        if (
          isMountedRef.current &&
          composerRevisionRef.current === sendRevision &&
          lifecycleRef.current.isControlAuthorized &&
          lifecycleRef.current.presentationSessionId === sendLifecycle.presentationSessionId &&
          lifecycleRef.current.keyId === sendLifecycle.keyId &&
          composerDraftRef.current.recipient === 'control' &&
          composerDraftRef.current.text.trim() === targetText
        ) {
          setSendError(translate('liveAudio:Conversations.couldNotSend', 'No se pudo preparar o enviar el mensaje. El borrador se conserva.'));
        }
      } finally {
        if (isMountedRef.current) {
          setIsSending(false);
        }
      }
      return;
    }

    if (!onSendConversation) return;
    setIsSending(true);
    setSendError(null);
    const targetId = selectedRecipient;
    const sendRevision = ++composerRevisionRef.current;
    const sendLifecycle = { ...lifecycleRef.current };
    const targetText = text;

    try {
      const result = await onSendConversation(targetId, text);
      if (
        isMountedRef.current &&
        composerRevisionRef.current === sendRevision &&
        lifecycleRef.current.isControlAuthorized &&
        lifecycleRef.current.presentationSessionId === sendLifecycle.presentationSessionId &&
        lifecycleRef.current.keyId === sendLifecycle.keyId &&
        composerDraftRef.current.recipient === targetId &&
        composerDraftRef.current.text.trim() === targetText
      ) {
        if (result.audienceQueued) {
          setComposerText('');
          composerDraftRef.current.text = '';
          setSelectedRecipient('control');
          composerDraftRef.current.recipient = 'control';
          setSendError(null);
        } else {
          setSendError(translate('liveAudio:Conversations.couldNotSend', 'No se pudo preparar o enviar el mensaje. El borrador se conserva.'));
        }
      }
    } catch {
      if (
        isMountedRef.current &&
        composerRevisionRef.current === sendRevision &&
        lifecycleRef.current.isControlAuthorized &&
        lifecycleRef.current.presentationSessionId === sendLifecycle.presentationSessionId &&
        lifecycleRef.current.keyId === sendLifecycle.keyId &&
        composerDraftRef.current.recipient === targetId &&
        composerDraftRef.current.text.trim() === targetText
      ) {
        setSendError(translate('liveAudio:Conversations.couldNotSend', 'No se pudo preparar o enviar el mensaje. El borrador se conserva.'));
      }
    } finally {
      if (isMountedRef.current) {
        setIsSending(false);
      }
    }
  };

  const renderReplyFailures = (replyId: string, audienceFailureShown = false) => {
    const result = replyResults[replyId];
    if (!result) return null;
    return <>
      {!result.audienceQueued && !audienceFailureShown && <p role="alert" className="text-xs text-red-400">
        {translate('liveAudio:PrivateControlInbox.replyAudienceFailed', 'Audience: no se pudo enviar la respuesta.')}
      </p>}
      {!result.controlsQueued && <p role="alert" className="text-xs text-amber-400">
        {translate('liveAudio:PrivateControlInbox.replyControlsFailed', 'Controles: no se pudo enviar la sincronización.')}
      </p>}
    </>;
  };

  const renderInlineReplyForm = (
    replyId: string,
    participantId: string,
    placeholder: string,
    isAmber = false,
  ) => {
    if (activeReplyId !== replyId) return null;
    const currentDraft = replyDrafts[replyId] || '';

    return (
      <div className={`mt-2 pt-2 border-t ${isAmber ? 'border-amber-700/40' : 'border-gray-700'}`}>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={currentDraft}
            onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [replyId]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSendReply(replyId, participantId);
              }
            }}
            placeholder={placeholder}
            className={`flex-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white placeholder-gray-500 focus:outline-hidden focus:ring-1 ${
              isAmber ? 'focus:ring-amber-500' : 'focus:ring-blue-500'
            }`}
          />
          <button
            type="button"
            onClick={() => handleSendReply(replyId, participantId)}
            disabled={!currentDraft.trim()}
            title={translate("liveAudio:PrivateControlInbox.reply", "Responder")}
            aria-label={translate("liveAudio:PrivateControlInbox.reply", "Responder")}
            className={`${
              isAmber ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'
            } disabled:opacity-40 text-white px-2.5 py-1 rounded text-xs font-bold flex items-center`}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed top-16 end-0 md:end-4 w-full md:w-[420px] max-h-[75vh] bg-gray-900 border border-gray-700 md:rounded-lg shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="p-2.5 bg-gray-800 border-b border-gray-700 flex flex-wrap items-center justify-between shrink-0 gap-2">
        <h3 className="font-bold text-gray-200 text-sm flex items-center gap-1.5 shrink-0">
          <MessageSquare size={16} className="text-blue-400" />
          <span>{translate("liveAudio:PrivateControlInbox.notifications", "Notificaciones")}</span>
        </h3>

        {/* Operator Nick & Visibility selector */}
        <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-700/80 rounded-sm px-2 py-1">
          <User size={13} className="text-gray-400 shrink-0" />
          <input
            type="text"
            value={operatorNick}
            onChange={handleOperatorNickChange}
            placeholder={translate("liveAudio:PrivateControlInbox.operatorNickname", "Nick operador...")}
            maxLength={25}
            className="bg-transparent text-xs text-white placeholder-gray-500 focus:outline-hidden w-20 md:w-24"
            title={translate("liveAudio:PrivateControlInbox.operatorNickname_6b2ec7", "Nick del operador")}
          />
          <button
            type="button"
            onClick={handleToggleNickPublic}
            className="p-0.5 text-gray-400 hover:text-white transition-colors"
            title={
              isNickPublic
                ? translate("liveAudio:PrivateControlInbox.publicNicknameUsersWillSeeControl", "Nick público hacia usuarios: se mostrará \"Control ({{value1}})\"", { value1: operatorNick || 'Nick' })
                : translate("liveAudio:PrivateControlInbox.privateNicknameUsersWillOnlySeeControl", "Nick privado hacia usuarios: se mostrará solo como \"Control\"")
            }
            aria-label={translate("liveAudio:PrivateControlInbox.togglePublicNicknameVisibility", "Alternar visibilidad pública del nick")}
          >
            {isNickPublic ? (
              <UserCheck size={14} className="text-emerald-400" />
            ) : (
              <UserX size={14} className="text-gray-400" />
            )}
          </button>
        </div>
        {onProgramAudioEnabledChange && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-gray-200 cursor-pointer" title={translate("liveAudio:PrivateControlInbox.presentationAudioHeardByThisControl", "Audio de la presentación que escucha este Control")}>
              <input type="checkbox" checked={Boolean(programAudioEnabled)} onChange={e => onProgramAudioEnabledChange(e.target.checked)} />
              <span>{translate("liveAudio:PrivateControlInbox.programAudio", "🔊 Audio de programa")}</span>
            </label>
            {mediaAvailable && <AudioDeviceSettings />}
          </div>
        )}
      </div>

      {/* Main Content List */}
      <div className="overflow-y-auto p-2 space-y-3 flex-1">
        {!mediaAvailable && (
          <div className="bg-red-950/30 border border-red-900/50 rounded-md p-2 flex items-start gap-2">
            <ShieldAlert size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">
              {translate('liveAudio:Conversations.mediaUnavailable', 'Audio en directo no disponible. La participación y los mensajes siguen disponibles.')}</p>
          </div>
        )}

        {!hasItems && (
          <div className="p-6 text-center text-gray-500 text-xs italic">
            {translate("liveAudio:PrivateControlInbox.noPendingNotifications", "Sin notificaciones pendientes.")}</div>
        )}

        {/* Authorization Requests */}
        {authorizationRequests.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider px-1">
              {translate("liveAudio:PrivateControlInbox.controlRequests", "Solicitudes de Control (")}{authorizationRequests.length})
            </div>
            {authorizationRequests.map((req) => (
              <div key={req.controlSessionId} className="bg-blue-900/20 border border-blue-800/50 rounded-md p-2.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <KeyRound size={15} className="text-blue-400" />
                  <span className="text-xs font-semibold text-blue-200">{translate("liveAudio:PrivateControlInbox.newControlConnected", "Nuevo Control Conectado")}</span>
                </div>
                <div className="text-xs text-blue-300 mb-2.5">
                  {translate("liveAudio:PrivateControlInbox.verificationCode", "Código de verificación:")}{' '}
                  <strong className="text-white text-sm tracking-widest">{req.verificationCode}</strong>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onApproveRequest(req.controlSessionId)}
                    className="flex-1 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 text-white py-1 rounded-sm text-xs transition-colors font-medium"
                  >
                    <Check size={13} />  {translate("liveAudio:PrivateControlInbox.approve", "Aprobar")}</button>
                  <button
                    onClick={() => onRejectRequest(req.controlSessionId)}
                    className="flex-1 flex items-center justify-center gap-1 bg-gray-700 hover:bg-gray-600 text-gray-200 py-1 rounded-sm text-xs transition-colors"
                  >
                    <X size={13} />  {translate("liveAudio:PrivateControlInbox.reject", "Rechazar")}</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Audience Access Requests - Pending */}
        {pendingAccessRequests.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider px-1">
              {translate("liveAudio:PrivateControlInbox.pendingAccessRequests", "Accesos Pendientes (")}{pendingAccessRequests.length})
            </div>
            {pendingAccessRequests.map((request) => {
              const accessReplyId = `access-${request.participantId}`;
              const isReplyingAccess = activeReplyId === accessReplyId;

              return (
                <div
                  key={request.participantId}
                  className="rounded-md border border-amber-700/60 bg-amber-950/30 p-2.5"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold text-amber-100">
                      {translate("liveAudio:PrivateControlInbox.entryRequest", "Solicitud de Entrada")}</div>
                    <span className="text-[11px] text-gray-400 font-mono">
                      {formatTime(request.requestedAt)}
                    </span>
                  </div>
                  <div className="mb-2.5 text-sm font-medium text-white">{request.alias}</div>

                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onAudienceAccessDecision(request.participantId, 'ADMIT')}
                      className="rounded-sm bg-emerald-700 hover:bg-emerald-600 py-1 text-xs font-bold text-white transition-colors"
                      title={translate("liveAudio:PrivateControlInbox.admitUser", "Admitir usuario")}
                    >
                      {translate("liveAudio:PrivateControlInbox.admit", "Admitir")}</button>
                    <button
                      type="button"
                      onClick={() => onAudienceAccessDecision(request.participantId, 'REJECT')}
                      className="rounded-sm bg-slate-700 hover:bg-slate-600 py-1 text-xs font-bold text-white transition-colors"
                      title={translate("liveAudio:PrivateControlInbox.reject30sCooldown", "Rechazar (cooldown 30s)")}
                    >
                      {translate("liveAudio:PrivateControlInbox.reject", "Rechazar")}</button>
                    <button
                      type="button"
                      onClick={() => onAudienceAccessDecision(request.participantId, 'BLOCK')}
                      className="rounded-sm bg-red-800 hover:bg-red-700 py-1 text-xs font-bold text-white transition-colors"
                      title={translate("liveAudio:PrivateControlInbox.blockAccessCompletely", "Bloquear acceso totalmente")}
                    >
                      {translate("liveAudio:PrivateControlInbox.block", "Bloquear")}</button>
                    <button
                      type="button"
                      onClick={() => setActiveReplyId(isReplyingAccess ? null : accessReplyId)}
                      className={`rounded py-1 text-xs font-bold transition-colors flex items-center justify-center ${
                        isReplyingAccess
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                      title={translate("liveAudio:PrivateControlInbox.replyToWaitingUser", "Responder al usuario en espera")}
                      aria-label={translate("liveAudio:PrivateControlInbox.replyToWaitingUser", "Responder al usuario en espera")}
                    >
                      <MessageSquare size={13} />
                    </button>
                  </div>

                  {renderReplyFailures(accessReplyId)}
                  {renderInlineReplyForm(
                    accessReplyId,
                    request.participantId,
                    'Mensaje a usuario en espera...',
                    true,
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Audience Access Requests - Blocked */}
        {blockedAccessRequests.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-red-400 uppercase tracking-wider px-1">
              {translate("liveAudio:PrivateControlInbox.blockedUsers", "Usuarios Bloqueados (")}{blockedAccessRequests.length})
            </div>
            {blockedAccessRequests.map((request) => (
              <div
                key={request.participantId}
                className="rounded-md border border-red-900/50 bg-red-950/20 p-2.5 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-red-200 truncate">{request.alias}</div>
                  <div className="text-[10px] text-gray-500 font-mono">{translate("liveAudio:PrivateControlInbox.accessBanned", "Acceso vetado")}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onAudienceAccessDecision(request.participantId, 'UNBLOCK')}
                  className="rounded-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 text-xs font-bold text-gray-200 hover:text-white transition-colors shrink-0"
                  title={translate("liveAudio:PrivateControlInbox.unblockAndMoveToPendingRequests", "Desbloquear y mover a solicitudes pendientes")}
                >
                  {translate("liveAudio:PrivateControlInbox.unblock", "Desbloquear")}</button>
              </div>
            ))}
          </div>
        )}

        {/* Private Messages & Inter-Control Messages */}
        {messages.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider px-1">
              {translate("liveAudio:PrivateControlInbox.messages", "Mensajes (")}{messages.length})
            </div>
            {messages.map((msg) => {
              const isReplying = activeReplyId === msg.id;

              if (msg.isInterControl) {
                return (
                  <div
                    key={msg.id}
                    className="bg-blue-950/30 border border-blue-800/50 rounded-md p-2.5 group"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-sm bg-blue-900/60 text-blue-300 border border-blue-700/50">
                          {translate("liveAudio:PrivateControlInbox.controlTeam", "Equipo Control")}</span>
                        <span className="text-xs font-semibold text-blue-200">{msg.fromAlias}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 font-mono">
                          {formatTime(msg.timestamp)}
                        </span>
                        <button
                          onClick={() => onDismissMessage(msg.id)}
                          className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                          title={translate("liveAudio:PrivateControlInbox.dismissNotice", "Descartar aviso")}
                          aria-label={translate("liveAudio:PrivateControlInbox.dismissNotice", "Descartar aviso")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-blue-100 leading-relaxed">{msg.content}</p>
                  </div>
                );
              }

              if (msg.isControlToAudience) {
                return (
                  <div
                    key={msg.id}
                    data-operation-id={msg.id}
                    className="bg-amber-950/30 border border-amber-800/50 rounded-md p-2.5 group"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-sm bg-blue-900/60 text-blue-300 border border-blue-700/50">
                          {translate("liveAudio:PrivateControlInbox.controlTeam", "Equipo Control")}
                        </span>
                        <span className="text-xs font-semibold text-amber-200 flex items-center gap-1">
                          <bdi>{msg.fromAlias}</bdi>
                          <span className="text-gray-400">→</span>
                          <bdi className="text-white">{msg.toAlias || translate("liveAudio:PrivateControlInbox.audienceUser", "Usuario")}</bdi>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 font-mono">
                          {formatTime(msg.timestamp)}
                        </span>
                        <button
                          onClick={() => onDismissMessage(msg.id)}
                          className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                          title={translate("liveAudio:PrivateControlInbox.dismissNotice", "Descartar aviso")}
                          aria-label={translate("liveAudio:PrivateControlInbox.dismissNotice", "Descartar aviso")}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-amber-100 leading-relaxed" dir="auto">{msg.content}</p>
                    {msg.audienceQueued === false && (
                      <p role="alert" className="text-[10px] text-red-400 mt-1">
                        {translate('liveAudio:PrivateControlInbox.replyAudienceFailed', 'Audience: no se pudo enviar la respuesta.')}
                      </p>
                    )}
                    {msg.controlsQueued === false && (
                      <p role="alert" className="text-[10px] text-amber-400 mt-0.5">
                        {translate('liveAudio:PrivateControlInbox.replyControlsFailed', 'Controles: no se pudo enviar la sincronización.')}
                      </p>
                    )}
                  </div>
                );
              }

              return (
                <div key={msg.id} className="bg-gray-800 border border-gray-700 rounded-md p-2.5 group">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-300">
                        {translate("liveAudio:PrivateControlInbox.from", "De:")} <span className="text-white">{msg.fromAlias}</span>
                      </span>
                      {msg.isWaitingRoom && (
                        <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-sm bg-amber-900/60 text-amber-300 border border-amber-700/50">
                          {translate("liveAudio:PrivateControlInbox.waiting", "En espera")}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 font-mono">
                        {formatTime(msg.timestamp)}
                      </span>
                      <button
                        onClick={() => onDismissMessage(msg.id)}
                        className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        title={translate("liveAudio:PrivateControlInbox.dismissMessage", "Descartar mensaje")}
                        aria-label={translate("liveAudio:PrivateControlInbox.dismissMessageFrom", "Descartar mensaje de {{value1}}", { value1: msg.fromAlias })}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-gray-200 leading-relaxed mb-2">"{msg.content}"</p>

                  {/* Replies trail */}
                  {msg.replies && msg.replies.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {msg.replies.map((reply) => (
                        <div
                          key={reply.replyId}
                          className="text-[11px] bg-emerald-950/40 border border-emerald-800/40 rounded-sm px-2 py-1 text-emerald-200"
                        >
                          <div className="flex items-center justify-between text-[10px] text-emerald-400 font-medium mb-0.5">
                            <span>{translate('liveAudio:PrivateControlInbox.replyAuthor', 'Respuesta de')} {reply.repliedBy}</span>
                            <span className="font-mono">{formatTime(reply.repliedAt)}</span>
                          </div>
                          <p className="text-gray-200 italic">"{reply.responseText}"</p>
                          {!reply.audienceQueued && <p role="alert">{translate('liveAudio:PrivateControlInbox.replyAudienceFailed', 'Audience: no se pudo enviar la respuesta.')}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions: Quick Thank, Reply & Block */}
                  {renderReplyFailures(msg.id, msg.replies?.some(reply => !reply.audienceQueued))}
                  {msg.fromParticipantId && (
                    <div className="flex items-center gap-1.5 pt-1 border-t border-gray-700/50">
                      {onReplyToParticipant && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleQuickThank(msg)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-sm bg-gray-700/70 hover:bg-emerald-800/50 hover:text-emerald-200 text-[11px] text-gray-300 transition-colors"
                            title={translate("liveAudio:PrivateControlInbox.sendAQuickThankYouConfirmationWithOneClick", "Enviar 'Gracias' de confirmación rápida con 1 clic")}
                          >
                            <Sparkles size={11} className="text-amber-400" />  {translate("liveAudio:PrivateControlInbox.thank", "Agradecer")}</button>

                          <button
                            type="button"
                            onClick={() => setActiveReplyId(isReplying ? null : msg.id)}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
                              isReplying
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700/70 hover:bg-gray-600 text-gray-300'
                            }`}
                          >
                            <CornerDownRight size={11} />{' '}
                            {msg.replies && msg.replies.length > 0 ? translate("liveAudio:PrivateControlInbox.replyAgain", "Responder de nuevo") : translate("liveAudio:PrivateControlInbox.reply", "Responder")}
                          </button>
                        </>
                      )}

                      {onAudienceAccessDecision && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(translate("liveAudio:PrivateControlInbox.blockAccessFor", "¿Bloquear acceso a {{value1}}?", { value1: msg.fromAlias }))) {
                              onAudienceAccessDecision(msg.fromParticipantId!, 'BLOCK');
                            }
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-sm bg-gray-700/70 hover:bg-red-800/60 hover:text-red-200 text-[11px] text-gray-400 transition-colors ms-auto"
                          title={translate("liveAudio:PrivateControlInbox.blockAccessForThisParticipant", "Bloquear acceso a este participante")}
                          aria-label={translate("liveAudio:PrivateControlInbox.blockAccessFor_d2b424", "Bloquear acceso a {{value1}}", { value1: msg.fromAlias })}
                        >
                          <ShieldAlert size={11} className="text-red-400" />  {translate("liveAudio:PrivateControlInbox.block", "Bloquear")}</button>
                      )}
                    </div>
                  )}

                  {msg.fromParticipantId &&
                    renderInlineReplyForm(
                      msg.id,
                      msg.fromParticipantId,
                      'Escribe tu respuesta...',
                      false,
                    )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: Compact horizontal composer */}
      {isControlAuthorized && (onSendInterControlMessage || onSendConversation) && (
        <>
          {sendError && (
            <div role="alert" className="px-2.5 py-1.5 border-t border-red-800 bg-red-950/60 text-xs text-red-300 shrink-0">
              {sendError}
            </div>
          )}
          {!isSelectedRecipientEligible && (
            <div role="status" className="px-2.5 py-1 text-xs text-amber-400 bg-amber-950/40 border-t border-amber-900/40 shrink-0">
              {translate('liveAudio:Conversations.unavailable', 'Envío seguro no disponible')}
            </div>
          )}
          <form
            onSubmit={handleSendFromComposer}
            className="p-2 border-t border-gray-700 bg-gray-800/80 flex items-center gap-1.5 shrink-0"
          >
          <select
            value={selectedRecipient}
            onChange={(e) => {
              setSelectedRecipient(e.target.value);
              composerDraftRef.current.recipient = e.target.value;
              composerRevisionRef.current += 1;
            }}
            className={`px-2 py-1.5 rounded-sm text-xs font-medium border transition-colors focus:outline-hidden max-w-[130px] truncate ${
              selectedRecipient === 'control'
                ? 'bg-gray-900 border-gray-700 text-gray-200 focus:ring-1 focus:ring-blue-500'
                : 'bg-emerald-950 border-emerald-600 text-emerald-200 focus:ring-1 focus:ring-emerald-500'
            }`}
            aria-label={translate("liveAudio:PrivateControlInbox.recipient", "Destinatario")}
          >
            <option value="control">
              {translate("liveAudio:PrivateControlInbox.recipientControl", "Control")}
            </option>
            {conversationRecipients.map((r) => (
              <option key={r.participantId} value={r.participantId}>
                {r.eligible
                  ? r.alias
                  : translate('liveAudio:Conversations.recipientUnavailable', '{{alias}} (envío no disponible)', { alias: r.alias })}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={composerText}
            onChange={(e) => {
              setComposerText(e.target.value);
              composerDraftRef.current.text = e.target.value;
              composerRevisionRef.current += 1;
            }}
            placeholder={
              selectedRecipient === 'control'
                ? translate("liveAudio:PrivateControlInbox.noticeForTheControlTeam", "Aviso para el equipo de control...")
                : translate("liveAudio:PrivateControlInbox.privateMessageTo", "Mensaje a {{alias}}...", {
                    alias: selectedRecipientAlias || translate("liveAudio:PrivateControlInbox.audienceUser", "Usuario"),
                  })
            }
            dir="auto"
            maxLength={selectedRecipient === 'control' ? 200 : 1000}
            className="flex-1 px-2.5 py-1.5 bg-gray-900 border border-gray-700 rounded-sm text-xs text-white placeholder-gray-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 min-w-0"
            aria-label={translate("liveAudio:PrivateControlInbox.message", "Mensaje")}
          />
          <button
            type="submit"
            disabled={!composerText.trim() || isSending || !isSelectedRecipientEligible}
            className={`${
              selectedRecipient === 'control'
                ? 'bg-blue-600 hover:bg-blue-500'
                : 'bg-emerald-600 hover:bg-emerald-500'
            } disabled:opacity-40 text-white px-3 py-1.5 rounded-sm text-xs font-semibold flex items-center gap-1 transition-colors shrink-0`}
            title={translate("liveAudio:PrivateControlInbox.send", "Enviar")}
            aria-label={translate("liveAudio:PrivateControlInbox.send", "Enviar")}
          >
            <Send size={12} />
          </button>
        </form>
        </>
      )}
    </div>
  );
};
