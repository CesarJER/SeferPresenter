import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const WELCOME_ENDPOINT = '/api/branding/welcome.md';

export const BrandingWelcome = () => {
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    void fetch(WELCOME_ENDPOINT, { signal: controller.signal })
      .then((response) => response.ok ? response.text() : '')
      .then(setMarkdown)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setMarkdown('');
      });

    return () => controller.abort();
  }, []);

  if (!markdown.trim()) return null;

  return (
    <div className="max-w-none text-slate-300 text-sm leading-relaxed border-t border-b border-slate-800/80 py-4 w-full text-start [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-white [&_h1]:mb-2 [&_p]:text-slate-300 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_blockquote]:border-l-2 [&_blockquote]:border-blue-500/50 [&_blockquote]:ps-4 [&_blockquote]:italic [&_blockquote]:text-slate-400 [&_blockquote]:my-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
};
