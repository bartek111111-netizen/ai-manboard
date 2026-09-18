/**
 * Real file picker modal (Faza 10+): browse the filesystem via the server API.
 */
import { useEffect, useState } from "react";
import { t } from "../i18n";

interface DirEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
}

interface BrowseResponse {
  path: string;
  parent: string | null;
  entries: DirEntry[];
}

export function FilePicker({
  initialPath = "/mnt/dane",
  onSelect,
  onClose,
  isFile = true,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
  isFile?: boolean;
}) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const load = (path: string, hidden = false): void => {
    setLoading(true);
    setError(null);
    const showParam = hidden ? "&showHidden=true" : "";
    fetch(`/api/v1/browse?path=${encodeURIComponent(path)}${showParam}`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((data: BrowseResponse) => {
        setEntries(data.entries);
        setParent(data.parent);
        setCurrentPath(data.path);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(initialPath, showHidden);
  }, [initialPath, showHidden]);

  const navigate = (path: string): void => {
    load(path, showHidden);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal file-picker" onClick={(e) => e.stopPropagation()}>
        <h2>{isFile ? t("selectFile") : t("selectFolder")}</h2>

        <div className="file-picker-path">
          <button
            type="button"
            className="btn small"
            disabled={!parent}
            onClick={() => parent && navigate(parent)}
          >
            ↑ {t("upDir")}
          </button>
          <span className="file-picker-current">{currentPath}</span>
          <label className="checkbox-label small">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            {t("showHidden")}
          </label>
        </div>

        <div className="file-picker-list">
          {loading && <p className="muted">{t("loading")}</p>}
          {error && <p className="error-notice">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="muted">{t("emptyDir")}</p>
          )}
          {entries
            .filter((entry) => showHidden || !entry.name.startsWith("."))
            .map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`file-picker-entry ${entry.type}`}
                onClick={() => {
                  if (entry.type === "dir") {
                    navigate(entry.path);
                  } else if (!isFile) {
                    // Folder picker: select the folder itself
                    onSelect(currentPath);
                    onClose();
                  } else {
                    // File picker: select the file
                    onSelect(entry.path);
                    onClose();
                  }
                }}
              >
                <span className="file-picker-icon">
                  {entry.type === "dir" ? "📁" : "📄"}
                </span>
                <span className="file-picker-name">{entry.name}</span>
                {entry.type === "file" && entry.size != null && (
                  <span className="file-picker-size">
                    {(entry.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
              </button>
            ))}
        </div>

        <div className="modal-actions">
          {!isFile && (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onSelect(currentPath);
                onClose();
              }}
            >
              {t("selectCurrentDir")}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {t("cancelBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
