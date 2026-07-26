import React from 'react';

const configuredOrgName = import.meta.env.VITE_ORGANIZATION_NAME?.trim() || '';
const orgName = configuredOrgName || 'Responsable no configurado';
const orgLegalId = import.meta.env.VITE_ORGANIZATION_LEGAL_ID || "";
const orgEmail = import.meta.env.VITE_ORGANIZATION_EMAIL || "";
const orgWebsite = import.meta.env.VITE_ORGANIZATION_WEBSITE || "";

const DataProtectionPage: React.FC = () => {
  return (
    <div className="h-screen bg-gray-50 text-gray-800 p-6 sm:p-12 font-sans overflow-y-auto">
      <div className="max-w-4xl mx-auto bg-white p-8 rounded-xl shadow-md space-y-8">
        <header className="border-b pb-6">
          <h1 className="text-3xl font-bold text-gray-900">Política de Privacidad y Protección de Datos</h1>
          <p className="text-sm text-gray-500 mt-2">Plataforma SeferPresenter</p>
        </header>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">1. Responsable del tratamiento</h2>
          <ul className="list-disc pl-6 space-y-1 text-gray-700">
            <li><strong>Responsable:</strong> {orgName}</li>
            {orgLegalId && <li><strong>Identificación:</strong> {orgLegalId}</li>}
            {orgEmail && <li><strong>Correo electrónico:</strong> <a href={`mailto:${orgEmail}`} className="text-blue-600 hover:underline">{orgEmail}</a></li>}
            {orgWebsite && <li><strong>Sitio web:</strong> <a href={orgWebsite} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{orgWebsite}</a></li>}
          </ul>
          {!configuredOrgName && (
            <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
              Este despliegue debe configurar la identidad y el canal de contacto de la entidad responsable antes de publicarse.
            </p>
          )}
          <p className="text-gray-700">
            SeferPresenter se utiliza para reuniones, estudios, actividades formativas, retransmisiones y eventos organizados por {orgName}.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">2. Principios de privacidad</h2>
          <p className="text-gray-700">SeferPresenter aplica privacidad desde el diseño y minimización de datos:</p>
          <ul className="list-disc pl-6 space-y-1 text-gray-700">
            <li>No requiere cuentas de usuario para participar.</li>
            <li>No solicita nombre real para escuchar una sesión.</li>
            <li>No requiere correo electrónico para acceder como oyente.</li>
            <li>No genera perfiles permanentes de participantes.</li>
            <li>No incorpora vídeo de los asistentes (solo voz si se activa el micrófono).</li>
            <li>Usa un identificador aleatorio y efímero para separar respuestas de cuestionario; no requiere identidad real.</li>
            <li>No conserva historiales personales de participación.</li>
            <li>No guarda los alias elegidos entre diferentes sesiones.</li>
            <li>No almacena chats ni mensajes privados tras la sesión.</li>
          </ul>
          <p className="text-gray-700 text-sm italic">
            La plataforma está diseñada para minimizar la identificación técnica, pero esto no constituye un anonimato absoluto garantizado frente a requisitos legales o la naturaleza de su participación oral.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">3. Audiencia pasiva</h2>
          <p className="text-gray-700">
            La audiencia pasiva puede escuchar o ver la proyección sincronizada sin proporcionar alias, cuenta, email o identificación nominal. No se requieren permisos de micrófono. La activación del micrófono nunca se produce de forma automática.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">4. Audiencia activa y alias temporal bajo demanda</h2>
          <p className="text-gray-700">
            Se considera audiencia activa a la persona que decide realizar una acción participativa, como pedir la palabra, activar el micrófono o enviar un mensaje privado a Control.
          </p>
          <p className="text-gray-700">
            El alias temporal solo se solicita en estos casos, es elegido libremente por usted y puede no corresponder a su identidad real. Este alias es visible para los controles autorizados de la sesión y, únicamente si usted lo autoriza, para otros participantes activos. Desaparece al finalizar la sesión y su finalidad es gestionar solicitudes y acciones de moderación.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">5. Información tratada durante una sesión</h2>
          <p className="text-gray-700">Durante una sesión se tratan de manera efímera:</p>
          <ul className="list-disc pl-6 space-y-1 text-gray-700">
            <li>Un identificador técnico aleatorio de conexión.</li>
            <li>Estado de permisos y conexión.</li>
            <li>El alias temporal enviado al equipo de moderación.</li>
            <li>Mensajes privados cifrados dirigidos a Control.</li>
            <li>Audio transmitido voluntariamente.</li>
          </ul>
          <p className="text-gray-700">
            La aplicación no persiste en disco historiales nominales ni rankings. Durante la sesión, el servidor y Control procesan respuestas individuales vinculadas únicamente a un identificador aleatorio efímero para operar el cuestionario; se eliminan al cerrar o rotar la sesión. Todo registro técnico inevitable de infraestructura se minimizará.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">6. Mensajes privados hacia Control</h2>
          <p className="text-gray-700">
            El canal de mensajes es efímero, unidireccional y privado (de la audiencia hacia Control). Solo el equipo de moderación autorizado puede leerlo, y todos los datos viajan cifrados. Desaparecen al finalizar la sesión.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">7. Cuestionarios interactivos</h2>
          <p className="text-gray-700">
            Los cuestionarios calculan la puntuación localmente. El servidor mantiene temporalmente respuestas y puntuaciones asociadas a un identificador aleatorio de la sesión para sincronizar Control, sin nombre real ni ranking nominal persistente. Logout o rotación de sesión purgan el estado local y el servidor no lo escribe en disco.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">8. Grabaciones de reuniones</h2>
          <p className="text-gray-700">
            Las reuniones ordinarias pueden ser grabadas y difundidas por {orgName} en sus canales oficiales (web propia, Telegram, YouTube u otros). Las intervenciones realizadas voluntariamente mediante micrófono formarán parte de dichas grabaciones, pero sus alias temporales no se incluirán visualmente en la proyección.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">9. Infraestructura y Seguridad</h2>
          <p className="text-gray-700">
            El sistema de voz opcional (LiveKit) es operado por nosotros o nuestros proveedores autorizados. Para proteger las comunicaciones se emplea cifrado en tránsito (HTTPS/WSS) y tokens de acceso efímeros. El alias puede ser procesado por el servidor y por los controles autorizados durante la sesión.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800">10. Conservación y Derechos</h2>
          <p className="text-gray-700">
            Los datos efímeros como alias, mensajes e identidad de cuestionario se eliminan al finalizar o rotar la sesión. Las grabaciones podrán conservarse como parte del archivo histórico, educativo o cultural.
          </p>
          <p className="text-gray-700">
            Puede ejercer los derechos reconocidos por la normativa aplicable (acceso, rectificación, supresión, limitación y oposición) contactando a:{' '}
            {orgEmail ? <a href={`mailto:${orgEmail}`} className="text-blue-600 hover:underline">{orgEmail}</a> : 'los responsables'}.
          </p>
        </section>

      </div>
    </div>
  );
};

export default DataProtectionPage;
