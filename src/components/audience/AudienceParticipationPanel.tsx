import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X } from 'lucide-react';
import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import { useAudienceParticipation } from '../../hooks/useAudienceParticipation';
import { useAudienceLiveAudio } from '../../features/liveAudio/components/audience/AudienceLiveAudioContext';
import { AudienceLiveAudioPanel } from '../../features/liveAudio/components/audience/AudienceLiveAudioPanel';
import { AudienceInterventionModal } from '../../features/liveAudio/components/audience/AudienceInterventionModal';
import { AudiencePrivateControlMessage } from '../../features/liveAudio/components/audience/AudiencePrivateControlMessage';

export function AudienceParticipationPanel() {
  useUiTranslation('liveAudio');
  const owner = useAudienceParticipation();
  const media = useAudienceLiveAudio();
  const [joining, setJoining] = useState(false);
  const [messaging, setMessaging] = useState(false);
  const noMedia = () => {};
  const mediaAvailable = Boolean(media && media.availability === 'enabled');
  const microphoneAvailable = mediaAvailable && (media?.state === 'connected' || media?.state === 'reconnected');
  return <>
    <AudienceLiveAudioPanel
      state={media?.state ?? 'unavailable'}
      mediaAvailable={mediaAvailable}
      socialReady={owner.socialReady}
      isActive={owner.isActive}
      isPendingWord={owner.isPendingWord}
      isWordGranted={owner.isWordGranted && microphoneAvailable}
      isParticipationBlocked={owner.isKicked}
      isMicrophoneActive={media?.isMicrophoneActive ?? false}
      microphoneTrackState={media?.microphoneTrackState ?? 'off'}
      hasAudioStarted={media?.hasAudioStarted ?? false}
      volume={media?.volume ?? 1}
      onVolumeChange={media?.onVolumeChange ?? noMedia}
      microphoneVolume={media?.microphoneVolume}
      isMusicMode={media?.isMusicMode}
      onMicrophoneVolumeChange={media?.onMicrophoneVolumeChange}
      onMusicModeChange={media?.onMusicModeChange}
      onStartAudio={media?.onStartAudio ?? noMedia}
      onRetryAudio={media?.onRetryAudio ?? noMedia}
      onToggleMicrophone={media?.onToggleMicrophone ?? noMedia}
      onJoinActive={() => setJoining(true)}
      onLeaveActive={owner.leave}
      onRequestWord={owner.requestWord}
      onCancelRequest={owner.cancelRequest}
      onOpenMessage={() => setMessaging(true)}
      isAliasVisibleToOthers={owner.audienceSession.aliasVisible}
      onAliasVisibilityChange={owner.changeAliasVisibility}
      canViewActiveParticipants={owner.canViewActiveParticipants}
      visibleParticipants={owner.visibleParticipants}
      microphoneDiagnostics={media?.microphoneDiagnostics}
      externalBroadcastState={owner.externalBroadcastState}
      variant="inline"
    />
    {!owner.socialReady && <span role="status" className="rounded-sm bg-gray-950/90 p-1 text-xs text-gray-200">
      {translate('liveAudio:AudienceParticipationPanel.preparingSecureParticipation', 'Participación segura no disponible. Comprueba la conexión y el cifrado.')}
    </span>}
    {createPortal(<>
    {joining && <AudienceInterventionModal
      onClose={() => setJoining(false)}
      defaultAliasVisible={owner.audienceSession.aliasVisible}
      externalBroadcastState={owner.externalBroadcastState}
      submitDisabled={!owner.socialReady}
      onSubmit={(alias, visible) => { if (owner.activate(alias, visible)) setJoining(false); }}
    />}
    {messaging && <AudiencePrivateControlMessage onClose={() => setMessaging(false)} onSend={owner.sendPrivateMessage} />}
    {owner.receivedControlMessages.length > 0 && <div className="fixed top-4 end-4 start-4 md:start-auto md:w-96 z-50 space-y-2 pointer-events-auto">
      {owner.receivedControlMessages.map(message => <div key={message.id}
        className="rounded-xl border border-blue-600/50 bg-gray-900/95 p-3.5 shadow-2xl backdrop-blur-md text-white">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span>{translate('liveAudio:LiveAudioAudienceContainer.messageFrom', 'Mensaje de')} <bdi>{message.senderNick}</bdi></span>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button type="button" onClick={() => owner.dismissControlMessage(message.id)}
            className="p-1 rounded-sm focus-visible:outline-2 focus-visible:outline-blue-400"
            aria-label={translate('liveAudio:LiveAudioAudienceContainer.closeMessage', 'Cerrar mensaje')}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <p dir="auto" className="text-xs text-gray-100 leading-relaxed ps-5">"{message.text}"</p>
      </div>)}
    </div>}
    </>, document.body)}
  </>;
}
