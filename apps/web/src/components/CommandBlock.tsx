/**
 * CommandBlock / CommandPopover — a launch command shown in a monospace,
 * wrapping block with a "Kopiuj" (copy-to-clipboard) button, plus an ⓘ button
 * that reveals the same command in a hover/focus popup. Used by the app
 * Status cards (the engine header) and the external-instance card (the
 * captured command line).
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';

/** The command in a monospace block with a copy button. */
export function CommandBlock({ command, className = '' }: { command: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className={`cmd ${className}`.trim()}>
      <code className="cmd-block">{command}</code>
      <button type="button" className="btn small info-copy" onClick={copy}>
        {copied ? t('copied') : t('copyCommand')}
      </button>
    </div>
  );
}

/** The ⓘ button; on hover/focus it reveals the command (copyable) in a popup. */
export function CommandPopover({ command, label }: { command: string; label: string }) {
  return (
    <span className="info-btn" tabIndex={0} aria-label={label}>
      <svg
        className="info-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" strokeLinecap="round" />
        <circle cx="12" cy="8" r="1.3" fill="currentColor" stroke="none" />
      </svg>
      <span className="info-popup">
        <p className="info-popup-label">{label}</p>
        <CommandBlock command={command} />
      </span>
    </span>
  );
}
