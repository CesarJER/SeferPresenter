import { useState, useEffect, useCallback } from 'react';
import { makeClientId } from '../utils/normalizePresentation';

interface UseAudienceSessionProps {
  subscribeToWsMessage?: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
}

export function useAudienceSession({ subscribeToWsMessage }: UseAudienceSessionProps = {}) {
  const [deviceId, setDeviceId] = useState<string>('');
  const [nick, setNick] = useState<string>('');
  const [presentationSessionId, setPresentationSessionId] = useState<string | null>(null);

  // Initialize from localStorage
  useEffect(() => {
    let savedDeviceId = localStorage.getItem('sefer-audience-device-id');
    if (!savedDeviceId) {
      savedDeviceId = makeClientId();
      localStorage.setItem('sefer-audience-device-id', savedDeviceId);
    }
    setDeviceId(savedDeviceId);

    const savedNick = localStorage.getItem('sefer-audience-nick') || '';
    setNick(savedNick);

    const savedSessionId = localStorage.getItem('sefer-audience-session-id');
    if (savedSessionId) {
      setPresentationSessionId(savedSessionId);
    }
  }, []);

  const clearLocalSession = useCallback(() => {
    localStorage.removeItem('sefer-audience-nick');
    localStorage.removeItem('sefer-audience-session-id');
    
    // Opcionalmente borrar respuestas de quiz guardadas (limpiar la sesión activa actual)
    const activeQuizSession = localStorage.getItem('sefer-audience-session-id');
    if (activeQuizSession) {
       // El quiz maneja la data usando la key, así que lo manejaremos disparando un evento o borrando todo
       // Por ahora solo removemos nuestro knowledge
    }

    setNick('');
    setPresentationSessionId(null);
    
    // Disparar evento para que otras partes de la app reaccionen al logout
    window.dispatchEvent(new CustomEvent('sefer-audience-logout'));
  }, []);

  // Listen to WebSocket to keep track of the server's presentationSessionId
  useEffect(() => {
    if (!subscribeToWsMessage) return;

    const handler = (type: string, payload: Record<string, unknown>) => {
      if (type === 'WELCOME') {
        const serverSessionId = payload.presentationSessionId as string | undefined;
        if (serverSessionId) {
          const localSessionId = localStorage.getItem('sefer-audience-session-id');
          if (localSessionId && localSessionId !== serverSessionId) {
            console.log('[AudienceSession] Server session ID differs from local, purging local session...');
            clearLocalSession();
          }
          localStorage.setItem('sefer-audience-session-id', serverSessionId);
          setPresentationSessionId(serverSessionId);
        }
      } else if (type === 'PRESENTATION_SESSION_ROTATED') {
        const newSessionId = payload.presentationSessionId as string;
        console.log('[AudienceSession] Presentation session rotated, purging local session...');
        clearLocalSession();
        localStorage.setItem('sefer-audience-session-id', newSessionId);
        setPresentationSessionId(newSessionId);
      }
    };

    return subscribeToWsMessage(handler);
  }, [subscribeToWsMessage, clearLocalSession]);

  const login = useCallback((newNick: string) => {
    const trimmed = newNick.trim().slice(0, 50);
    localStorage.setItem('sefer-audience-nick', trimmed);
    setNick(trimmed);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('sefer-audience-nick');
    setNick('');
  }, []);

  return {
    deviceId,
    nick,
    presentationSessionId,
    login,
    logout,
    isLoggedIn: !!nick
  };
}
