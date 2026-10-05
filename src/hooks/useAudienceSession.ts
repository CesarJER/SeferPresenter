import { useState, useEffect, useCallback } from 'react';
import { readExpiringStorage, writeExpiringStorage } from '../utils/privacyStorage';

const IDENTITY_KEY = 'sefer-audience-identity';
const SESSION_KEY = 'sefer-audience-session-id';
const LEGACY_KEYS = ['sefer-audience-nick', 'sefer-audience-alias-visible'];
const IDENTITY_EVENT = 'sefer-audience-identity-change';
type Identity = { nick: string; aliasVisible: boolean; sessionId: string | null };
const emptyIdentity = (): Identity => ({ nick: '', aliasVisible: false, sessionId: null });
const readIdentity = (): Identity => {
  LEGACY_KEYS.forEach(key => localStorage.removeItem(key));
  const identity = readExpiringStorage<Identity>(localStorage, IDENTITY_KEY);
  const sessionId = readExpiringStorage<string>(localStorage, SESSION_KEY);
  if (!identity || typeof identity.nick !== 'string'
    || typeof identity.aliasVisible !== 'boolean'
    || (identity.sessionId !== null && typeof identity.sessionId !== 'string')
    || (identity.sessionId && identity.sessionId !== sessionId)) {
    localStorage.removeItem(IDENTITY_KEY);
    return emptyIdentity();
  }
  return identity;
};
interface UseAudienceSessionProps {
  subscribeToWsMessage?: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
}
export function useAudienceSession({ subscribeToWsMessage }: UseAudienceSessionProps = {}) {
  const [identity, setIdentity] = useState<Identity>(() => {
    const initial = readIdentity();
    if (!localStorage.getItem(IDENTITY_KEY)) initial.aliasVisible = String(import.meta.env.VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT ?? 'false').toLowerCase() === 'true';
    return initial;
  });
  const [presentationSessionId, setPresentationSessionId] = useState<string | null>(() => readExpiringStorage(localStorage, SESSION_KEY));
  const reconcile = useCallback(() => {
    setIdentity(readIdentity());
    setPresentationSessionId(readExpiringStorage(localStorage, SESSION_KEY));
  }, []);
  const clearLocalSession = useCallback(() => {
    [IDENTITY_KEY, SESSION_KEY, 'sefer-quiz-session-id', ...LEGACY_KEYS].forEach(key => localStorage.removeItem(key));
    window.dispatchEvent(new CustomEvent('sefer-audience-logout'));
    window.dispatchEvent(new CustomEvent(IDENTITY_EVENT));
  }, []);
  useEffect(() => {
    const reconcileBoundary = () => {
      if (identity.nick && !readIdentity().nick) clearLocalSession();
      else reconcile();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || [IDENTITY_KEY, SESSION_KEY].includes(event.key)) reconcileBoundary();
    };
    window.addEventListener(IDENTITY_EVENT, reconcile);
    window.addEventListener('sefer-audience-logout', reconcile);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', reconcileBoundary);
    const raw = localStorage.getItem(IDENTITY_KEY);
    const expiresAt = raw ? (JSON.parse(raw) as { expiresAt: number }).expiresAt : 0;
    const timer = expiresAt ? window.setTimeout(reconcileBoundary, Math.max(0, expiresAt - Date.now())) : undefined;
    return () => {
      window.removeEventListener(IDENTITY_EVENT, reconcile);
      window.removeEventListener('sefer-audience-logout', reconcile);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', reconcileBoundary);
      window.clearTimeout(timer);
    };
  }, [reconcile, clearLocalSession, identity]);
  useEffect(() => {
    if (!subscribeToWsMessage) return;
    return subscribeToWsMessage((type, payload) => {
      if (type !== 'WELCOME' && type !== 'PRESENTATION_SESSION_ROTATED') return;
      const sessionId = payload.presentationSessionId;
      if (typeof sessionId !== 'string' || !sessionId) return;
      const localSessionId = readExpiringStorage<string>(localStorage, SESSION_KEY);
      if (type === 'PRESENTATION_SESSION_ROTATED' || (localSessionId && localSessionId !== sessionId)) clearLocalSession();
      // Reconnect must not extend the privacy boundary.
      if (type === 'PRESENTATION_SESSION_ROTATED' || localSessionId !== sessionId) writeExpiringStorage(localStorage, SESSION_KEY, sessionId);
      const current = readIdentity();
      if (current.nick && !current.sessionId) {
        const envelope = JSON.parse(localStorage.getItem(IDENTITY_KEY)!);
        envelope.data.sessionId = sessionId;
        localStorage.setItem(IDENTITY_KEY, JSON.stringify(envelope));
      }
      window.dispatchEvent(new CustomEvent(IDENTITY_EVENT));
      if (type === 'PRESENTATION_SESSION_ROTATED' && payload.hardRefresh) window.setTimeout(() => window.location.reload(), 150);
    });
  }, [subscribeToWsMessage, clearLocalSession]);
  const saveIdentity = useCallback((next: Identity) => {
    writeExpiringStorage(localStorage, IDENTITY_KEY, next);
    const sessionRaw = localStorage.getItem(SESSION_KEY);
    if (sessionRaw) {
      const envelope = JSON.parse(localStorage.getItem(IDENTITY_KEY)!);
      envelope.expiresAt = Math.min(envelope.expiresAt, JSON.parse(sessionRaw).expiresAt);
      localStorage.setItem(IDENTITY_KEY, JSON.stringify(envelope));
    }
    window.dispatchEvent(new CustomEvent(IDENTITY_EVENT));
  }, []);
  const login = useCallback((newNick: string) => {
    const current = readIdentity();
    saveIdentity({ ...current, aliasVisible: localStorage.getItem(IDENTITY_KEY) ? current.aliasVisible : identity.aliasVisible, nick: newNick.trim().slice(0, 50), sessionId: readExpiringStorage(localStorage, SESSION_KEY) });
  }, [saveIdentity, identity.aliasVisible]);
  const setAliasVisible = useCallback((value: boolean) => saveIdentity({ ...readIdentity(), aliasVisible: value }), [saveIdentity]);
  return { nick: identity.nick, aliasVisible: identity.aliasVisible, presentationSessionId,
    login, logout: clearLocalSession, setAliasVisible, isLoggedIn: !!identity.nick };
}
