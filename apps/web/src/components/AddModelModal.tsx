/**
 * Modal for adding a model manually (Faza 7+).
 * Uses the real FilePicker for path selection.
 */
import { useState } from "react";
import { postModel } from "../api/client";
import { FilePicker } from "./FilePicker";
import { t } from "../i18n";

function extractDisplayName(path: string): string {
  const basename = path.split("/").pop() ?? path;
  const noExt = basename.replace(/\.gguf$/i, "");
  const match = noExt.match(/^(.*?)(?:[-_.](?:\d+B|gguf))?(?:[-_.](\d+B))?/);
  if (match && match[1]) {
    return match[1].replace(/[-_.]+/g, " ").trim();
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
  const [path, setPath] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSelect = (selectedPath: string): void => {
    setPath(selectedPath);
    if (!displayName) setDisplayName(extractDisplayName(selectedPath));
    setShowPicker(false);
  };

  const handleSubmit = (): void => {
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    postModel({
      path: path.trim(),
      displayName: displayName.trim() || undefined,
    })
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
    <>
      {showPicker && (
        <FilePicker
          initialPath="/mnt/dane"
          onSelect={handleSelect}
          onClose={() => setShowPicker(false)}
          isFile={true}
        />
      )}

      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>{t("addModelTitle")}</h2>

          <div className="form-field">
            <label>{t("modelPathLabel")}</label>
            <div className="file-input-row">
              <input
                type="text"
                className="input"
                value={path}
                placeholder="/mnt/dane/models/....gguf"
                onChange={(e) => {
                  setPath(e.target.value);
                  if (!displayName)
                    setDisplayName(extractDisplayName(e.target.value));
                }}
              />
              <button
                type="button"
                className="btn small"
                onClick={() => setShowPicker(true)}
              >
                {t("browseBtn")}
              </button>
            </div>
          </div>

          <div className="form-field">
            <label>{t("displayNameLabel")}</label>
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
              {t("cancelBtn")}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !path.trim()}
              onClick={handleSubmit}
            >
              {busy ? t("addingBtn") : t("addModelBtn")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
