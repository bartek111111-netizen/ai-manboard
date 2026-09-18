import { useState } from "react";
import {
  discoverModels,
  getConfig,
  putEngine,
  putGlobalConfig,
  type EngineCheck,
  type PutEngineResult,
} from "../api/client";
import { ErrorNotice } from "../components/ErrorNotice";
import { t } from "../i18n";
import { errInfo } from "../ui/errors";

/**
 * Onboarding wizard (Faza 7.5, ONB-1/ONB-2): step 1 = the `llama-server`
 * binary (file picker + [Sprawdź] precheck), step 2 = model directories
 * (file pickers + [Zapisz]). [Nowy skan] triggers discovery; [Pomiń] skips.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [binary, setBinary] = useState("");
  const [check, setCheck] = useState<EngineCheck | null>(null);
  const [checkError, setCheckError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [dirs, setDirs] = useState("");
  const [saveError, setSaveError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [scanResult, setScanResult] = useState<{
    added: number;
    total: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setSaveError(errInfo(err));
    } finally {
      setBusy(false);
    }
  };

  const doCheck = (): void => {
    setCheck(null);
    setCheckError(null);
    putEngine("llama-server", { binary })
      .then((result: PutEngineResult) => {
        setCheck(result.check);
      })
      .catch((err: unknown) => {
        setCheckError(errInfo(err));
      });
  };

  const saveDirs = (): void => {
    const list = dirs
      .split(/[\n,]/)
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    void run(async () => {
      const config = await getConfig();
      await putGlobalConfig({ ...config.global, modelDirs: list });
      setSaveError(null);
      onDone();
    });
  };

  const doScan = (): void => {
    void run(async () => {
      const result = await discoverModels();
      setScanResult({ added: result.added.length, total: result.total });
      setSaveError(null);
    });
  };

  return (
    <section className="onboarding">
      <h1>{t("onbTitle")}</h1>
      <p className="muted">{t("onbIntro")}</p>

      <h2>{t("onbBinaryStep")}</h2>
      <input
        type="text"
        className="input"
        placeholder={t("onbBinaryPlaceholder")}
        value={binary}
        onChange={(e) => setBinary(e.target.value)}
      />
      <div className="instance-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || binary.trim() === ""}
          onClick={doCheck}
        >
          {t("onbCheck")}
        </button>
      </div>
      {check && (
        <p className="status-ok">
          {t("onbCheckOk")} — {check.versionLine}
          {check.vulkan ? " · libvulkan OK" : " · libvulkan BRAK"}
        </p>
      )}
      <ErrorNotice
        message={checkError?.message ?? null}
        code={checkError?.code}
      />

      <h2>{t("onbDirsStep")}</h2>
      <textarea
        className="input"
        rows={3}
        placeholder={t("onbDirsPlaceholder")}
        value={dirs}
        onChange={(e) => setDirs(e.target.value)}
      />
      <div className="instance-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || dirs.trim() === ""}
          onClick={saveDirs}
        >
          {t("actionSave")}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={doScan}>
          {t("actionScan")}
        </button>
      </div>
      {scanResult && (
        <p className="status-ok">
          {t("onbScanResult")} +{scanResult.added}, łącznie {scanResult.total}
        </p>
      )}
      <ErrorNotice
        message={saveError?.message ?? null}
        code={saveError?.code}
      />

      <div className="instance-actions">
        <button type="button" className="btn" onClick={onDone}>
          {t("onbSkip")}
        </button>
      </div>
    </section>
  );
}
