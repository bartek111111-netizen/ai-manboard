import { useCallback, useEffect, useState } from 'react';
import type { InstanceState } from '@ai-dashboard/shared';
import {
  getInstance,
  restartInstance,
  startInstance,
  stopInstance,
  type InstanceDto,
} from '../api/client';
import { openEventStream } from '../api/sse';
import { t } from '../i18n';
import { errInfo } from '../ui/errors';
import { isLiveState } from '../ui/state';
import { ErrorNotice } from './ErrorNotice';
import { StatusBadge } from './StatusBadge';

const POLL_MS = 3000;

/**
 * Instance panel (Faza 7.2, PLAN §20.2/Instancja): state, PID, port, uptime,
 * endpoint (copy) + [Start][Stop][Restart]. Polls the full DTO and listens to
 * the SSE state stream so the badge updates in real time.
 */
export function InstancePanel({ modelId, presetName }: { modelId: string; presetName: string }) {
  const instanceId = `${modelId}--${presetName}`;
  const [dto, setDto] = useState<InstanceDto | null>(null);
  const [state, setState] = useState<InstanceState>('unknown');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const poll = useCallback((): void => {
    getInstance(instanceId)
      .then((result) => {
        setDto(result);
        setState(result.state);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(errInfo(err));
      });
  }, [instanceId]);

  useEffect(() => {
    setDto(null);
    poll();
    const timer = setInterval(poll, POLL_MS);
    // The SSE state stream updates the badge in real time (Faza 6).
    const closeStream = openEventStream((event) => {
      if (event.instanceId === instanceId) setState(event.state);
    });
    return () => {
      clearInterval(timer);
      closeStream();
    };
  }, [instanceId, poll]);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setError(null);
      poll();
    } catch (err) {
      setError(errInfo(err));
    } finally {
      setBusy(false);
    }
  };

  const copyEndpoint = (): void => {
    if (dto) {
      void navigator.clipboard.writeText(dto.endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const live = isLiveState(state);

  return (
    <section>
      <div className="instance-head">
        <span className="instance-id">{instanceId}</span>
        <StatusBadge state={state} />
      </div>

      <ErrorNotice message={error?.message ?? null} code={error?.code} />

      <dl className="kv">
        <dt>{t('fieldState')}</dt>
        <dd>
          <StatusBadge state={state} small />
        </dd>
        <dt>{t('fieldPreset')}</dt>
        <dd>{presetName}</dd>
        <dt>{t('fieldPort')}</dt>
        <dd>{dto?.port ?? '—'}</dd>
        <dt>{t('fieldPid')}</dt>
        <dd>{dto?.pid ?? '—'}</dd>
        <dt>{t('fieldUptime')}</dt>
        <dd>{dto?.uptimeSec !== null && dto ? `${dto.uptimeSec} s` : '—'}</dd>
        <dt>{t('fieldEndpoint')}</dt>
        <dd className="endpoint">
          {dto?.endpoint ?? '—'}
          {dto && (
            <button type="button" className="btn small" onClick={copyEndpoint}>
              {copied ? t('copied') : t('copy')}
            </button>
          )}
        </dd>
      </dl>

      {dto?.lastError && (
        <p className="status-error">
          {t('lastError')} (exit: {dto.lastError.exitCode ?? '—'}
          {dto.lastError.signal ? `, signal: ${dto.lastError.signal}` : ''})
        </p>
      )}

      <div className="instance-actions">
        {!live && (
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => startInstance(instanceId))}>
            {t('actionStart')}
          </button>
        )}
        {live && (
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => stopInstance(instanceId))}>
            {t('actionStop')}
          </button>
        )}
        {live && (
          <button type="button" className="btn" disabled={busy} onClick={() => run(() => restartInstance(instanceId))}>
            {t('actionRestart')}
          </button>
        )}
      </div>
    </section>
  );
}
