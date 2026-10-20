import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import React from 'react';
import { LegalMarkdown } from '../../../../components/shared/LegalMarkdown';
import type { LiveAudioExternalBroadcastState } from '../../../../types/liveAudio';
import {
  configuredPrivacyPolicyPath,
  configuredPrivacySummaryPath,
  extractLegalDocumentVersion,
  prepareLegalMarkdownForDisplay,
  sha256Hex,
} from '../../../../utils/legalDocument';

interface CollapsiblePrivacyNoticeProps {
  externalBroadcastState: LiveAudioExternalBroadcastState;
  onCheckboxesChange: (allChecked: boolean) => void;
}

const stateNotice: Record<LiveAudioExternalBroadcastState, string> = {
  get off() { return translate("liveAudio:CollapsiblePrivacyNotice.noExternalBroadcastIsCurrentlyDeclaredIfThisChangesPrevious", "No hay retransmisión externa declarada en este momento. Si el estado cambia, los permisos de voz anteriores se revocarán."); },
  get live() { return translate("liveAudio:CollapsiblePrivacyNotice.theSessionIsDeclaredLiveIfYouPublishYourMicrophone", "La sesión está declarada en directo. Si publica su micrófono, su voz podrá llegar a destinatarios externos."); },
  get recording() { return translate("liveAudio:CollapsiblePrivacyNotice.theSessionIsDeclaredLiveAndRecordingIfYouPublish", "La sesión está declarada en directo y grabándose. Si publica su micrófono, su voz podrá conservarse en servicios externos del operador."); },
};

interface PolicyIdentity {
  version: string;
  sha256: string;
}

export const CollapsiblePrivacyNotice: React.FC<CollapsiblePrivacyNoticeProps> = ({
  externalBroadcastState,
  onCheckboxesChange,
}) => {
  useUiTranslation('liveAudio');
  const [checkedInformation, setCheckedInformation] = React.useState(false);
  const [checkedMicrophone, setCheckedMicrophone] = React.useState(false);
  const [agePath, setAgePath] = React.useState<'age14OrOver' | 'under14' | null>(null);
  const [checkedGuardian, setCheckedGuardian] = React.useState(false);
  const [privacySummary, setPrivacySummary] = React.useState<string | null>(null);
  const [policyIdentity, setPolicyIdentity] = React.useState<PolicyIdentity | null>(null);
  const [legalLoadError, setLegalLoadError] = React.useState(false);

  const ageConditionMet = agePath === 'age14OrOver' || (agePath === 'under14' && checkedGuardian);
  const legalInformationAvailable = Boolean(privacySummary && policyIdentity && !legalLoadError);
  const allRequirementsMet = checkedInformation && checkedMicrophone && ageConditionMet && legalInformationAvailable;

  React.useEffect(() => {
    const controller = new AbortController();
    const loadMarkdown = async (path: string): Promise<string> => {
      const response = await fetch(path, {
        cache: 'no-store',
        headers: { Accept: 'text/markdown, text/plain;q=0.9' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.trim()) throw new Error(translate("liveAudio:CollapsiblePrivacyNotice.emptyDocument", "documento vacío"));
      return text;
    };

    setPrivacySummary(null);
    setPolicyIdentity(null);
    setLegalLoadError(false);

    Promise.all([
      loadMarkdown(configuredPrivacySummaryPath),
      loadMarkdown(configuredPrivacyPolicyPath),
    ])
      .then(async ([summary, policy]) => {
        const sha256 = await sha256Hex(policy);
        if (controller.signal.aborted) return;
        setPrivacySummary(summary);
        setPolicyIdentity({
          version: extractLegalDocumentVersion(policy),
          sha256,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLegalLoadError(true);
      });

    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    onCheckboxesChange(allRequirementsMet);
  }, [allRequirementsMet, onCheckboxesChange]);

  return (
    <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800 p-4 text-sm text-gray-200 shadow-md">
      <div className="mb-3 border-b border-gray-700 pb-2 text-base font-semibold text-white">
        {translate("liveAudio:CollapsiblePrivacyNotice.noticeBeforeSpeaking", "Aviso antes de intervenir")}</div>

      <div className="mt-3 space-y-3 text-xs leading-relaxed text-gray-300">
        <p className="font-medium text-yellow-300">{stateNotice[externalBroadcastState]}</p>
        <p>
          {translate("liveAudio:CollapsiblePrivacyNotice.theMicrophoneDoesNotActivateAutomaticallyItRequiresControl", "El micrófono no se activa automáticamente. Requiere autorización de Control, permiso del navegador y una acción local.")}</p>
        <p>
          {translate("liveAudio:CollapsiblePrivacyNotice.yourAliasReachesAuthorizedControlsEncryptedItIsShared", "Su alias llega cifrado a los Controles autorizados. Solo se comparte con otros participantes activos si usted lo elige y Control lo autoriza.")}</p>
        <p>
          {translate("liveAudio:CollapsiblePrivacyNotice.privateMessagesReachControlAvoidThirdPartyDataOr", "Los mensajes privados llegan a Control. Evite datos de terceros o información que no sea necesaria para participar.")}</p>
        <p className="rounded-sm border border-amber-700/60 bg-amber-950/30 p-2 text-amber-100">
          {translate("liveAudio:CollapsiblePrivacyNotice.beforeSpeakingAvoidSayingYourFullNameOrOther", "Antes de hablar, evite decir su nombre completo u otros datos que le identifiquen y compruebe que no se oyen conversaciones o voces de fondo. Las plataformas externas pueden generar subtítulos automáticos de lo que diga.")}</p>
        {!privacySummary && !legalLoadError && (
          <p role="status" className="text-gray-400">{translate("liveAudio:CollapsiblePrivacyNotice.loadingBasicDataProtectionInformation", "Cargando información básica de protección de datos…")}</p>
        )}
        {legalLoadError && (
          <p role="alert" className="rounded-sm border border-red-700 bg-red-950/40 p-2 text-red-100">
            {translate("liveAudio:CollapsiblePrivacyNotice.couldNotLoadTheApplicableLegalInformationMicrophoneParticipation", "No se pudo cargar la información legal aplicable. La intervención por micrófono permanecerá bloqueada.")}</p>
        )}
        {privacySummary && (
          <section aria-label={translate("liveAudio:CollapsiblePrivacyNotice.basicDataProtectionInformation", "Información básica de protección de datos")} className="text-xs">
            <LegalMarkdown variant="dark">
              {prepareLegalMarkdownForDisplay(privacySummary)}
            </LegalMarkdown>
          </section>
        )}
        <p>
          {translate("liveAudio:CollapsiblePrivacyNotice.readTheConfiguredLegalInformationAt", "Consulte la información legal configurada en")}{' '}
          <a className="text-blue-400 underline" href="/proteccion-datos" target="_blank" rel="noreferrer">
            /proteccion-datos
          </a>.
          {policyIdentity && (
            <span className="text-gray-400">
              {' '}{translate("liveAudio:CollapsiblePrivacyNotice.version", "(versión")} {policyIdentity.version}{translate("liveAudio:CollapsiblePrivacyNotice.sha256", "; SHA-256 …")}{policyIdentity.sha256.slice(-12)}).
            </span>
          )}
        </p>
      </div>

      <div className="mt-4 space-y-3 pt-3">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded-sm border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            checked={checkedInformation}
            onChange={(event) => setCheckedInformation(event.target.checked)}
          />
          <span>{translate("liveAudio:CollapsiblePrivacyNotice.iHaveReadAndUnderstoodTheStatedStatusAnd", "He leído y comprendido el estado indicado y la información de privacidad aplicable.")}</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded-sm border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            checked={checkedMicrophone}
            onChange={(event) => setCheckedMicrophone(event.target.checked)}
          />
          <span>
            {translate("liveAudio:CollapsiblePrivacyNotice.iSpecificallyAuthorizeActivationOfMyMicrophoneForThis", "Autorizo específicamente la activación de mi micrófono para esta intervención y comprendo los destinatarios indicados para el estado actual.")}</span>
        </label>
        <fieldset className="space-y-2 rounded-sm border border-gray-700 p-3">
          <legend className="px-1 text-sm font-medium text-gray-200">{translate("liveAudio:CollapsiblePrivacyNotice.ageAndAuthorization", "Edad y autorización")}</legend>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="participant-age-path"
              value="age14OrOver"
              checked={agePath === 'age14OrOver'}
              onChange={() => {
                setAgePath('age14OrOver');
                setCheckedGuardian(false);
              }}
              className="mt-1 h-4 w-4 border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            />
            <span>{translate("liveAudio:CollapsiblePrivacyNotice.iAm14OrOlder", "Tengo 14 años o más.")}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="participant-age-path"
              value="under14"
              checked={agePath === 'under14'}
              onChange={() => setAgePath('under14')}
              className="mt-1 h-4 w-4 border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
            />
            <span>{translate("liveAudio:CollapsiblePrivacyNotice.iAmUnder14", "Tengo menos de 14 años.")}</span>
          </label>
          {agePath === 'under14' && (
            <label className="ms-6 flex cursor-pointer items-start gap-2 rounded-sm bg-gray-900/60 p-2">
              <input
                type="checkbox"
                checked={checkedGuardian}
                onChange={(event) => setCheckedGuardian(event.target.checked)}
                className="mt-1 h-4 w-4 rounded-sm border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
              />
              <span>
                {translate("liveAudio:CollapsiblePrivacyNotice.myParentOrLegalGuardianIsPresentHasRead", "Mi padre, madre o tutor legal está presente, ha leído este aviso y autoriza específicamente esta intervención por micrófono.")}</span>
            </label>
          )}
          <p className="text-xs text-gray-400">
            {translate("liveAudio:CollapsiblePrivacyNotice.thisSelectionIsNotSentOrStoredIfYou", "Esta selección no se envía ni se conserva. Si no puede declarar una opción válida, puede seguir la sesión sin activar el micrófono.")}</p>
        </fieldset>
      </div>
    </div>
  );
};
