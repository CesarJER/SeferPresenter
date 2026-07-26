import React, { useEffect, useState } from 'react';
import { operatorConfig } from '../../utils/operatorConfig';

const safeHref = (value: string): string | null => {
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
};

const renderInline = (text: string) => {
  const parts: React.ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(text.slice(cursor, index));
    const href = safeHref(match[2].trim());
    parts.push(href
      ? <a key={`${index}-${href}`} href={href} rel="noreferrer" className="text-blue-700 underline">{match[1]}</a>
      : match[1]);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
};

function SafeMarkdown({ markdown }: { markdown: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-6">
        {list.map((item, index) => <li key={`${index}-${item}`}>{renderInline(item)}</li>)}
      </ul>,
    );
    list = [];
  };

  markdown.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      return;
    }
    flushList();
    if (line.startsWith('### ')) {
      blocks.push(<h4 key={blocks.length} className="text-lg font-semibold">{renderInline(line.slice(4))}</h4>);
    } else if (line.startsWith('## ')) {
      blocks.push(<h3 key={blocks.length} className="text-xl font-semibold">{renderInline(line.slice(3))}</h3>);
    } else if (line.startsWith('# ')) {
      blocks.push(<h2 key={blocks.length} className="text-2xl font-bold">{renderInline(line.slice(2))}</h2>);
    } else {
      blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
    }
  });
  flushList();
  return <div className="space-y-4">{blocks}</div>;
}

const contactHref = operatorConfig.rightsContact.includes('@')
  ? `mailto:${operatorConfig.rightsContact}`
  : safeHref(operatorConfig.rightsContact);

const DataProtectionPage: React.FC = () => {
  const [localMarkdown, setLocalMarkdown] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/privacy-document', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { markdown?: unknown } | null) => {
        setLocalMarkdown(typeof body?.markdown === 'string' ? body.markdown : null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen overflow-y-auto bg-gray-50 p-6 font-sans text-gray-800 sm:p-12">
      <article className="mx-auto max-w-4xl space-y-8 rounded-xl bg-white p-8 shadow-md">
        <header className="border-b pb-6">
          <h1 className="text-3xl font-bold text-gray-900">Privacidad y protección de datos</h1>
          <p className="mt-2 text-sm text-gray-500">Información técnica de SeferPresenter y datos del operador</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Operador de esta instalación</h2>
          <dl className="grid gap-2 sm:grid-cols-[12rem_1fr]">
            <dt className="font-semibold">Entidad</dt><dd>{operatorConfig.operatorName}</dd>
            {operatorConfig.legalId && <><dt className="font-semibold">Identificación</dt><dd>{operatorConfig.legalId}</dd></>}
            <dt className="font-semibold">Contacto para derechos</dt>
            <dd>{contactHref
              ? <a href={contactHref} className="text-blue-700 underline">{operatorConfig.rightsContact}</a>
              : operatorConfig.rightsContact}</dd>
            <dt className="font-semibold">Base jurídica declarada</dt><dd>{operatorConfig.legalBasis}</dd>
            <dt className="font-semibold">Política publicada</dt>
            <dd><a href={operatorConfig.privacyUrl} className="text-blue-700 underline">{operatorConfig.privacyUrl}</a></dd>
          </dl>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Hechos técnicos del software</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>No se requieren cuentas personales para Audience; un alias no verifica identidad real.</li>
            <li>El servidor conserva estado técnico efímero y huellas criptográficas de credenciales, pero no recibe alias en claro. Las respuestas y puntuaciones de quiz se asocian en memoria al identificador técnico de la credencial; se eliminan al rotar la sesión y no se escriben en archivos ni bases de datos.</li>
            <li>Alias y configuración privada entre Controles se comparten mediante un overlay cifrado de extremo a extremo.</li>
            <li>Las respuestas de quiz y el último estado offline autorizado pueden conservarse localmente hasta logout, rotación o expiración.</li>
            <li>Live Audio es opcional y usa tokens efímeros. La activación del micrófono requiere una acción del participante.</li>
            <li>SeferPresenter declara el estado operativo de grabación, pero no inicia ni controla grabadores externos.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Política configurada</h2>
          <p>
            Grabación disponible: <strong>{operatorConfig.recordingAvailable ? 'sí' : 'no'}</strong>.
            Estado inicial: <strong>{operatorConfig.recordingDefault === 'RECORDING' ? 'se está grabando' : 'no se está grabando'}</strong>.
            Cambio durante la sesión: <strong>{operatorConfig.recordingMutable ? 'permitido' : 'no permitido'}</strong>.
          </p>
          <p>Modo de acceso inicial: <strong>{operatorConfig.accessDefault === 'PUBLIC' ? 'Público' : 'Controlado'}</strong>.</p>
        </section>

        {localMarkdown && (
          <section className="space-y-4 border-t pt-6">
            <h2 className="text-2xl font-semibold">Información organizativa adicional</h2>
            <SafeMarkdown markdown={localMarkdown} />
          </section>
        )}
      </article>
    </main>
  );
};

export default DataProtectionPage;
