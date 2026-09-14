/**
 * Modal for adding a model manually (Faza 7+).
 * File path input with a browse button (uses the server's file picker API).
 */
import { useState } from 'react';
import { postModel } from '../api/client';
import { t } from '../i18n';

function extractDisplayName(path: string): string {
  // Extract a nice name from the file path
  // e.g. "/models/Qwen3.8-27B-Ridge-3.7bpw.gguf" → "Qwen 3.8 27B"
  const basename = path.split('/').pop() ?? path;
  const noExt = basename.replace(/\.gguf$/i, '');
  // Try to extract model name + size
  const match = noExt.match(/^(.*?)(?:-\d+B|\d+B)?(?:[-_.](\d+B))?/);
  if (match && match[1]) {
    return match[1].replace(/[-_.]+/g, ' ').trim();
  }
  return noExt;
}

export function AddModelModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [path, setPath] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleBrowse = (): void => {
    // Use the server's file picker endpoint
    fetch('/api/v1/file-picker?type=file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initial: '/mnt/dane' }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { path?: string }) => {
        if (data.path) {
          setPath(data.path);
          if (!displayName) setDisplayName(extractDisplayName(data.path));
        }
      })
      .catch(() => {
        // Fallback: just show a prompt
        const input = window.prompt(t('filePathPrompt'), '/mnt/dane/');
        if (input) {
          setPath(input);
          if (!displayName) setDisplayName(extractDisplayName(input));
        }
      });
  };

  const handleSubmit = (): void => {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    postModel({ path: path.trim(), displayName: displayName.trim() || undefined })
      .then(() => {
        onAdded();
        onClose();
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('addModelTitle')}</h2>

        <div className="form-field">
          <label>{t('modelPathLabel')}</label>
          <div className="file-input-row">
            <input
              type="text"
              className="input"
              value={path}
              placeholder="/mnt/dane/models/....gguf"
              onChange={(e) => {
                setPath(e.target.value);
                if (!displayName) setDisplayName(extractDisplayName(e.target.value));
              }}
            />
            <button type="button" className="btn small" onClick={handleBrowse}>
              {t('browseBtn')}
            </button>
          </div>
        </div>

        <div className="form-field">
          <label>{t('displayNameLabel')}</label>
          <input
            type="text"
            className="input"
            value={displayName}
            placeholder="Qwen 3.8 27B"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>

        {error && <p className="error-notice">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('cancelBtn')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !path.trim()}
            onClick={handleSubmit}
          >
            {busy ? t('addingBtn') : t('addModelBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
