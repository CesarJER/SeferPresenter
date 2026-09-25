import { useState, useEffect, useCallback } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export function useAudioDevices() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [hasPermission, setHasPermission] = useState(false);

  const [liveMicrophoneId, setLiveMicrophoneIdState] = useState<string>(() => 
    localStorage.getItem('sefer.control.liveMicrophoneId') || 'default'
  );
  const [liveOutputId, setLiveOutputIdState] = useState<string>(() => 
    localStorage.getItem('sefer.control.liveOutputId') || 'default'
  );
  const [programOutputId, setProgramOutputIdState] = useState<string>(() => 
    localStorage.getItem('sefer.control.programOutputId') || 'default'
  );

  const setLiveMicrophoneId = useCallback((id: string) => {
    localStorage.setItem('sefer.control.liveMicrophoneId', id);
    setLiveMicrophoneIdState(id);
    window.dispatchEvent(new Event('sefer.audiodevices.changed'));
  }, []);

  const setLiveOutputId = useCallback((id: string) => {
    localStorage.setItem('sefer.control.liveOutputId', id);
    setLiveOutputIdState(id);
    window.dispatchEvent(new Event('sefer.audiodevices.changed'));
  }, []);

  const setProgramOutputId = useCallback((id: string) => {
    localStorage.setItem('sefer.control.programOutputId', id);
    setProgramOutputIdState(id);
    window.dispatchEvent(new Event('sefer.audiodevices.changed'));
  }, []);

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(allDevices.map(d => ({
        deviceId: d.deviceId,
        label: d.label || `${d.kind} (${d.deviceId.slice(0, 5)}...)`,
        kind: d.kind,
      })));
      
      const hasLabels = allDevices.some(d => d.label !== '');
      setHasPermission(hasLabels);
    } catch (err) {
      console.warn('Error loading audio devices:', err);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      await loadDevices();
    } catch (err) {
      console.error('Microphone permission denied:', err);
    }
  }, [loadDevices]);

  useEffect(() => {
    loadDevices();
    navigator.mediaDevices?.addEventListener('devicechange', loadDevices);
    
    const handleSync = () => {
      setLiveMicrophoneIdState(localStorage.getItem('sefer.control.liveMicrophoneId') || 'default');
      setLiveOutputIdState(localStorage.getItem('sefer.control.liveOutputId') || 'default');
      setProgramOutputIdState(localStorage.getItem('sefer.control.programOutputId') || 'default');
    };
    
    window.addEventListener('sefer.audiodevices.changed', handleSync);
    
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', loadDevices);
      window.removeEventListener('sefer.audiodevices.changed', handleSync);
    };
  }, [loadDevices]);

  return {
    devices,
    hasPermission,
    requestPermission,
    liveMicrophoneId,
    setLiveMicrophoneId,
    liveOutputId,
    setLiveOutputId,
    programOutputId,
    setProgramOutputId,
  };
}
