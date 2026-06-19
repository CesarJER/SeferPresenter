import React from 'react';

interface CollapsiblePrivacyNoticeProps {
  onCheckboxesChange: (allChecked: boolean) => void;
}

export const CollapsiblePrivacyNotice: React.FC<CollapsiblePrivacyNoticeProps> = ({ 
  onCheckboxesChange
}) => {
  const [checkedTerms, setCheckedTerms] = React.useState(false);
  const [checkedCapacity, setCheckedCapacity] = React.useState(false);

  const orgName = import.meta.env.VITE_ORGANIZATION_NAME || "la organización";
  const orgLegalId = import.meta.env.VITE_ORGANIZATION_LEGAL_ID || "";
  const orgEmail = import.meta.env.VITE_ORGANIZATION_EMAIL || "admin@example.com";
  // const orgWebsite = import.meta.env.VITE_ORGANIZATION_WEBSITE || "https://example.com";

  const handleTermsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCheckedTerms(e.target.checked);
    onCheckboxesChange(e.target.checked && checkedCapacity);
  };

  const handleCapacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCheckedCapacity(e.target.checked);
    onCheckboxesChange(checkedTerms && e.target.checked);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-200 shadow-md mb-4 border border-gray-700">
      <div className="mb-3 text-white font-semibold text-base border-b border-gray-700 pb-2">
        Aviso antes de intervenir
      </div>
      
      <div className="mt-3 text-xs leading-relaxed overflow-x-auto text-gray-300 space-y-3">
        <p className="text-yellow-300 font-medium">
          Esta reunión puede ser <strong className="font-bold text-yellow-400">grabada y difundida</strong> por {orgName} a través de sus canales oficiales.
        </p>
        <p>
          Por favor, evite compartir información personal o cualquier otra información que no desee que pueda formar parte de la grabación.
        </p>
        <p>
          Si interviene mediante el micrófono, su intervención podrá ser escuchada por los asistentes y su voz podrá formar parte de dichas grabaciones.
        </p>
        <p>
          El alias temporal y los mensajes privados dirigidos a Control solo serán visibles para Control y los Controles autorizados durante la sesión. No obstante, Control podrá mencionar, leer o responder públicamente al contenido de su mensaje o alias durante la reunión de forma pública para poder atender su petición.
        </p>
        
        <table className="w-full text-left border-collapse border border-gray-700 mt-4 mb-4 bg-gray-900 rounded-lg">
          <tbody>
            <tr className="border-b border-gray-700">
              <th className="p-2 border-r border-gray-700 text-white w-1/4 align-top">Responsable</th>
              <td className="p-2 align-top">{orgName}{orgLegalId ? `, ${orgLegalId}` : ''}. Contacto: <a href={`mailto:${orgEmail}`} className="text-blue-400">{orgEmail}</a>.</td>
            </tr>
            <tr className="border-b border-gray-700">
              <th className="p-2 border-r border-gray-700 text-white align-top">Finalidad</th>
              <td className="p-2 align-top">Organizar, desarrollar, retransmitir y, en su caso, grabar reuniones, estudios, actividades formativas, cultos y eventos de la comunidad mediante SeferPresenter. Gestionar la participación de los asistentes, solicitudes de palabra, intervenciones por micrófono, mensajes internos y actividades interactivas.</td>
            </tr>
            <tr className="border-b border-gray-700">
              <th className="p-2 border-r border-gray-700 text-white align-top">Legitimación</th>
              <td className="p-2 align-top">Tratamiento necesario para la organización y desarrollo de actividades religiosas, educativas y comunitarias de la entidad; participación voluntaria del asistente cuando solicita palabra, activa el micrófono o envía mensajes a Control; interés legítimo en la gestión técnica, seguridad y moderación de la sesión; y, cuando proceda, bases específicas aplicables a entidades religiosas y a la difusión de sus actividades.</td>
            </tr>
            <tr className="border-b border-gray-700">
              <th className="p-2 border-r border-gray-700 text-white align-top">Destinatarios</th>
              <td className="p-2 align-top">Los asistentes conectados podrán escuchar las intervenciones realizadas mediante micrófono. El personal de control autorizado podrá acceder a alias temporales y mensajes dirigidos a moderación durante la sesión. Las grabaciones se difunden publicamente en los canales oficiales de la comunidad. También podrán intervenir proveedores técnicos necesarios para alojamiento, retransmisión, seguridad o publicación de contenidos.</td>
            </tr>
            <tr className="border-b border-gray-700">
              <th className="p-2 border-r border-gray-700 text-white align-top">Derechos</th>
              <td className="p-2 align-top">Puede ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y, cuando proceda, portabilidad, contactando con <a href={`mailto:${orgEmail}`} className="text-blue-400">{orgEmail}</a>. Las solicitudes relativas a grabaciones se evaluarán individualmente conforme a la normativa aplicable.</td>
            </tr>
            <tr>
              <th className="p-2 border-r border-gray-700 text-white align-top">Información adicional</th>
              <td className="p-2 align-top">Puede consultar la Política de Privacidad completa en <span className="text-blue-400">/proteccion-datos</span>.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-3 pt-3">
        <label className="flex items-start gap-2 cursor-pointer group">
          <input 
            type="checkbox" 
            className="mt-1 w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 bg-gray-700"
            checked={checkedTerms}
            onChange={handleTermsChange}
          />
          <span className="text-sm group-hover:text-white transition-colors">
            He leído y he comprendido la información sobre privacidad, grabaciones e intervención pública.
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer group">
          <input 
            type="checkbox" 
            className="mt-1 w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-800 bg-gray-700"
            checked={checkedCapacity}
            onChange={handleCapacityChange}
          />
          <span className="text-sm group-hover:text-white transition-colors">
            Declaro tener capacidad para participar o, cuando sea legalmente necesario, contar con la autorización de mis padres, tutores o representantes legales.
          </span>
        </label>
      </div>
    </div>
  );
};
