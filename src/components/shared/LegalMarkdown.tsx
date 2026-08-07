import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface LegalMarkdownProps {
  children: string;
  variant?: 'light' | 'dark';
  className?: string;
}

const componentStyles = (variant: 'light' | 'dark'): Components => {
  const dark = variant === 'dark';
  const heading = dark ? 'text-white' : 'text-slate-950';
  const text = dark ? 'text-gray-300' : 'text-slate-700';
  const border = dark ? 'border-gray-700' : 'border-slate-200';
  const mutedBackground = dark ? 'bg-gray-950/50' : 'bg-slate-50';
  const link = dark ? 'text-blue-300 hover:text-blue-200' : 'text-blue-700 hover:text-blue-900';

  return {
    h1: ({ children }) => <h1 className={`mb-6 text-3xl font-bold tracking-tight ${heading}`}>{children}</h1>,
    h2: ({ children }) => <h2 className={`mb-3 mt-10 border-b pb-2 text-2xl font-semibold ${heading} ${border}`}>{children}</h2>,
    h3: ({ children }) => <h3 className={`mb-2 mt-7 text-xl font-semibold ${heading}`}>{children}</h3>,
    h4: ({ children }) => <h4 className={`mb-2 mt-5 text-base font-semibold ${heading}`}>{children}</h4>,
    p: ({ children }) => <p className={`my-3 break-words leading-7 ${text}`}>{children}</p>,
    strong: ({ children }) => <strong className={`font-semibold ${heading}`}>{children}</strong>,
    ul: ({ children }) => <ul className={`my-4 list-disc space-y-2 pl-6 ${text}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`my-4 list-decimal space-y-2 pl-6 ${text}`}>{children}</ol>,
    li: ({ children }) => <li className="break-words pl-1 leading-7">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote className={`my-5 border-l-4 px-4 py-2 ${border} ${mutedBackground}`}>{children}</blockquote>
    ),
    hr: () => <hr className={`my-8 ${border}`} />,
    table: ({ children }) => (
      <table className={`my-5 w-full table-auto border-collapse overflow-hidden rounded-lg border text-left text-inherit ${border}`}>
        {children}
      </table>
    ),
    thead: ({ children }) => <thead className={dark ? 'bg-gray-800' : 'bg-slate-100'}>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className={`border-b last:border-b-0 ${border}`}>{children}</tr>,
    th: ({ children }) => <th className={`break-words border-r p-3 align-top font-semibold last:border-r-0 ${border} ${heading}`}>{children}</th>,
    td: ({ children }) => <td className={`break-words border-r p-3 align-top leading-6 last:border-r-0 ${border} ${text}`}>{children}</td>,
    a: ({ href, children }) => {
      const external = Boolean(href && /^https?:\/\//i.test(href));
      return (
        <a
          href={href}
          className={`break-words underline decoration-1 underline-offset-2 ${link}`}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
        >
          {children}
        </a>
      );
    },
    code: ({ children }) => (
      <code className={`rounded px-1.5 py-0.5 font-mono text-[0.9em] ${dark ? 'bg-gray-800 text-gray-100' : 'bg-slate-100 text-slate-800'}`}>
        {children}
      </code>
    ),
  };
};

export const LegalMarkdown: React.FC<LegalMarkdownProps> = ({
  children,
  variant = 'light',
  className = '',
}) => (
  <div className={`block w-full min-w-0 max-w-full overflow-x-auto ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      disallowedElements={['img']}
      components={componentStyles(variant)}
    >
      {children}
    </ReactMarkdown>
  </div>
);
