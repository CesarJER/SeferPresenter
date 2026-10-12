import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  configuredPrivacyPolicyPath,
  extractLegalDocumentTitle,
  extractLegalDocumentVersion,
  prepareLegalMarkdownForDisplay,
  sha256Hex,
} from '../../utils/legalDocument';
import { LegalMarkdown } from './LegalMarkdown';

interface LoadedLegalDocument {
  text: string;
  title: string;
  version: string;
  sha256: string;
}

const DataProtectionPage: React.FC = () => {
  const [document, setDocument] = useState<LoadedLegalDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    setDocument(null);
    setError(null);

    fetch(configuredPrivacyPolicyPath, {
      cache: 'no-store',
      headers: { Accept: 'text/markdown, text/plain;q=0.9' },
      signal: abortController.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!text.trim()) throw new Error('documento vacío');
        return {
          text,
          title: extractLegalDocumentTitle(text),
          version: extractLegalDocumentVersion(text),
          sha256: await sha256Hex(text),
        };
      })
      .then(setDocument)
      .catch(reason => {
        if (abortController.signal.aborted) return;
        const message = reason instanceof Error ? reason.message : 'error desconocido';
        setError(`No se pudo cargar el documento legal configurado (${message}).`);
      });

    return () => abortController.abort();
  }, []);

  return (
    <main className="h-dvh overflow-x-hidden overflow-y-auto overscroll-y-contain bg-linear-to-b from-slate-100 to-white px-4 py-8 font-sans text-slate-800 sm:px-8 sm:py-12">
      <div className="mx-auto w-[calc(100vw-2rem)] min-w-0 max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 sm:w-[calc(100vw-4rem)]">
        <header className="border-b border-slate-200 bg-slate-950 px-6 py-8 text-white sm:px-10">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-blue-500/15 p-3 text-blue-300 ring-1 ring-blue-400/30">
              <ShieldCheck aria-hidden="true" className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-blue-300">Protección de datos</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                {document?.title || 'Información de privacidad'}
              </h1>
            </div>
          </div>
          {document && (
            <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-300" data-testid="legal-document-integrity">
              <span className="rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15">Versión {document.version}</span>
              <span
                className="max-w-full break-all rounded-2xl bg-white/10 px-3 py-1.5 font-mono leading-5 ring-1 ring-white/15"
              >
                SHA-256 {document.sha256}
              </span>
            </div>
          )}
        </header>

        <div className="w-full min-w-0 overflow-hidden px-5 py-7 sm:px-10 sm:py-10">
        {!document && !error && <p role="status" className="text-slate-600">Cargando documento legal…</p>}

        {error && (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-900">
            <p className="font-semibold">Documento legal no disponible</p>
            <p className="mt-1 text-sm">{error}</p>
            <p className="mt-2 text-sm">
              No active el micrófono ni facilite datos hasta que el operador restaure y revise la información aplicable.
            </p>
          </div>
        )}

        {document && (
          <article aria-label="Documento legal configurado" className="w-full min-w-0 max-w-full overflow-hidden">
            <LegalMarkdown>{prepareLegalMarkdownForDisplay(document.text)}</LegalMarkdown>
          </article>
        )}
        </div>
      </div>
    </main>
  );
};

export default DataProtectionPage;
