import { useEffect, useRef } from 'react';
import { CircleAlert } from 'lucide-react';

interface RecordingConfirmationDialogProps {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RecordingConfirmationDialog({
  pending,
  onConfirm,
  onCancel,
}: RecordingConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    headingRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recording-confirmation-title"
        aria-describedby="recording-confirmation-description"
        className="w-full max-w-md rounded-2xl border border-red-500 bg-slate-950 p-6 text-white shadow-2xl"
      >
        <CircleAlert className="mb-3 h-8 w-8 text-red-400" aria-hidden="true" />
        <h2
          ref={headingRef}
          tabIndex={-1}
          id="recording-confirmation-title"
          className="text-xl font-bold outline-none"
        >
          Esta sesión está siendo grabada
        </h2>
        <p id="recording-confirmation-description" className="mt-3 text-sm text-slate-200">
          Confirma que has visto este aviso antes de habilitar tu micrófono.
          SeferPresenter declara el estado operativo, pero no controla el
          sistema externo de grabación.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            Ahora no
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {pending ? 'Confirmando…' : 'Confirmar y habilitar micrófono'}
          </button>
        </div>
      </div>
    </div>
  );
}
