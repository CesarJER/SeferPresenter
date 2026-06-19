import React from 'react';

export const LiveAudioNotice: React.FC = () => {
  return (
    <p className="text-sm text-gray-300">
      La plataforma está diseñada para minimizar la recopilación de información
      personal y no requiere cuentas de usuario ni identificación nominal para
      participar. Si interviene con micrófono o envía un mensaje a Control, se le
      pedirá un alias temporal elegido libremente. Consulte la{' '}
      <a href="/proteccion-datos" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
        política de privacidad completa
      </a>{' '}
      para más información.
    </p>
  );
};
