import { useState, useEffect, useCallback } from 'react';
import { makeClientId } from '../utils/normalizePresentation';
import { readExpiringStorage, writeExpiringStorage } from '../utils/privacyStorage';

const ALIAS_VISIBLE_KEY = 'sefer-audience-alias-visible';
const AUDIENCE_DEVICE_ID_KEY = 'sefer-audience-device-id';
const AUDIENCE_NICK_KEY = 'sefer-audience-nick';
const AUDIENCE_SESSION_ID_KEY = 'sefer-audience-session-id';
const QUIZ_SESSION_ID_KEY = 'sefer-quiz-session-id';

interface UseAudienceSessionProps {
  subscribeToWsMessage?: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
}

export function useAudienceSession({ subscribeToWsMessage }: UseAudienceSessionProps = {}) {
  const [deviceId, setDeviceId] = useState<string>(() => makeClientId());
  const [nick, setNick] = useState<string>('');
  const [aliasVisible, setAliasVisible] = useState<boolean>(false);
  const [presentationSessionId, setPresentationSessionId] = useState<string | null>(null);

  // Aliases and participant IDs are page-scoped. Remove values persisted by older versions.
  useEffect(() => {
    localStorage.removeItem(AUDIENCE_DEVICE_ID_KEY);
    localStorage.removeItem(AUDIENCE_NICK_KEY);
    localStorage.removeItem(ALIAS_VISIBLE_KEY);

    const defaultAliasVisible =
      String(import.meta.env.VITE_SEFER_ACTIVE_ALIAS_VISIBLE_BY_DEFAULT ?? 'false').toLowerCase() === 'true';
    setAliasVisible(defaultAliasVisible);

    const savedSessionId = readExpiringStorage<string>(localStorage, AUDIENCE_SESSION_ID_KEY);
    if (savedSessionId) {
      setPresentationSessionId(savedSessionId);
    }
  }, []);

  const clearLocalSession = useCallback(() => {
    localStorage.removeItem(AUDIENCE_DEVICE_ID_KEY);
    localStorage.removeItem(AUDIENCE_NICK_KEY);
    localStorage.removeItem(AUDIENCE_SESSION_ID_KEY);
    localStorage.removeItem(ALIAS_VISIBLE_KEY);
    localStorage.removeItem(QUIZ_SESSION_ID_KEY);

    setDeviceId(makeClientId());
    setNick('');
    setAliasVisible(false);
    setPresentationSessionId(null);

    window.dispatchEvent(new CustomEvent('sefer-audience-logout'));
  }, []);

  // Track the backend presentation session and purge local identity at its boundary.
  useEffect(() => {
    if (!subscribeToWsMessage) return;

    const handler = (type: string, payload: Record<string, unknown>) => {
      if (type === 'WELCOME') {
        const serverSessionId = payload.presentationSessionId as string | undefined;
        if (serverSessionId) {
          const localSessionId = readExpiringStorage<string>(localStorage, AUDIENCE_SESSION_ID_KEY);
          if (localSessionId && localSessionId !== serverSessionId) {
            clearLocalSession();
          }
          writeExpiringStorage(localStorage, AUDIENCE_SESSION_ID_KEY, serverSessionId);
          setPresentationSessionId(serverSessionId);
        }
      } else if (type === 'PRESENTATION_SESSION_ROTATED') {
        const newSessionId = payload.presentationSessionId;
        if (typeof newSessionId !== 'string' || !newSessionId) return;
        clearLocalSession();
        writeExpiringStorage(localStorage, AUDIENCE_SESSION_ID_KEY, newSessionId);
        setPresentationSessionId(newSessionId);
      }
    };

    return subscribeToWsMessage(handler);
  }, [subscribeToWsMessage, clearLocalSession]);

  const login = useCallback((newNick: string) => {
    setNick(newNick.trim().slice(0, 50));
  }, []);

  const logout = clearLocalSession;

  const setAliasVisibleCallback = useCallback((value: boolean) => {
    setAliasVisible(value);
  }, []);

  return {
    deviceId,
    nick,
    aliasVisible,
    presentationSessionId,
    login,
    logout,
    setAliasVisible: setAliasVisibleCallback,
    isLoggedIn: !!nick,
  };
}
