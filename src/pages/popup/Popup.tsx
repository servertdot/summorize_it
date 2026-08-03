import { useEffect, useMemo, useState } from 'react';

import type { AiDestination } from '@src/features/handoff/large-payload';
import { canCancelOperation } from '@src/features/summary-operation/operation-coordinator';
import { selectCaptionTrack, type YouTubePage } from '@src/features/youtube-transcript/transcript-operation';
import { DESTINATION_NAMES } from '@src/shared/destinations';
import { LARGE_PROMPT_WARNING_TOKENS } from '@src/shared/operation-policy';
import { isRecoverableOperation, isTerminalOperation, type SummaryOperationState } from '@src/shared/operation-state';

interface PopupState {
  page?: YouTubePage;
  summaryLanguage: string;
  operation?: SummaryOperationState;
}

export interface PopupClient {
  load(): Promise<PopupState>;
  saveSummaryLanguage(language: string): Promise<void>;
  prepare(destination: AiDestination, summaryLanguage: string, selectedTrackId?: string): Promise<SummaryOperationState>;
  open(operationId: string, destination: AiDestination): Promise<SummaryOperationState>;
  refresh(operationId: string): Promise<SummaryOperationState | undefined>;
  retry(operationId: string): Promise<SummaryOperationState>;
  cancel(operationId: string): Promise<void>;
  copy(operationId: string): Promise<void>;
}

const LANGUAGES = [
  ['ru', 'Русский'], ['en', 'English'], ['uk', 'Українська'], ['de', 'Deutsch'],
  ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'],
  ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'],
] as const;

export default function Popup({ client }: { client: PopupClient }) {
  const [state, setState] = useState<PopupState | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>();
  const [status, setStatus] = useState('Проверяем видео…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    client.load().then((loaded) => {
      if (!active) return;
      setState(loaded);
      setSelectedTrackId(loaded.page ? selectCaptionTrack(loaded.page)?.id : undefined);
      setStatus(loaded.operation?.statusMessage || 'Готово к суммаризации');
    }).catch((cause: unknown) => { if (active) setError(getErrorMessage(cause)); });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    const currentOperation = state?.operation;
    const operationId = currentOperation?.id;
    if (!operationId || isTerminalOperation(currentOperation)) return undefined;
    const timer = window.setInterval(() => {
      void client.refresh(operationId).then((operation) => {
        if (!operation) return;
        setState((current) => current ? { ...current, operation } : current);
        setStatus(operation.statusMessage);
        setBusy(!isRecoverableOperation(operation) && !isTerminalOperation(operation));
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [client, state?.operation?.id, state?.operation?.status]);

  const selectedTrack = useMemo(
    () => state?.page?.tracks.find((track) => track.id === selectedTrackId),
    [selectedTrackId, state?.page],
  );
  const captionsMissing = state?.page?.tracks.length === 0;
  const operation = state?.operation;

  const changeLanguage = async (language: string) => {
    if (!state) return;
    setState({ ...state, summaryLanguage: language });
    await client.saveSummaryLanguage(language);
  };

  const start = async (destination: AiDestination) => {
    if (!state?.page || busy) return;
    setBusy(true);
    setError(undefined);
    setStatus('Получаем полную расшифровку…');
    try {
      const prepared = await client.prepare(destination, state.summaryLanguage, selectedTrackId);
      setState({ ...state, operation: prepared });
      setStatus(sizeMessage(prepared));
      await nextPaint();
      const opened = await client.open(prepared.id, prepared.destination);
      setState((current) => current ? { ...current, operation: opened } : current);
    } catch (cause) {
      setError(getErrorMessage(cause));
      setStatus('Операция остановлена');
      setBusy(false);
    }
  };

  const openPrepared = async () => {
    if (!operation) return;
    setBusy(true);
    setError(undefined);
    try {
      const opened = await client.open(operation.id, operation.destination);
      setState((current) => current ? { ...current, operation: opened } : current);
    } catch (cause) {
      setError(getErrorMessage(cause));
      setBusy(false);
    }
  };

  const runRecovery = async (action: 'retry' | 'copy' | 'cancel') => {
    if (!operation) return;
    setError(undefined);
    try {
      if (action === 'copy') {
        await client.copy(operation.id);
        setStatus('Полный запрос скопирован');
      } else if (action === 'cancel') {
        await client.cancel(operation.id);
        setState({ ...state, operation: { ...operation, status: 'cancelled', statusMessage: 'Операция отменена' } });
        setStatus('Операция отменена');
      } else {
        const retried = await client.retry(operation.id);
        setState({ ...state, operation: retried });
        setStatus(retried.statusMessage);
        setBusy(true);
      }
    } catch (cause) { setError(getErrorMessage(cause)); }
  };

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <span className="eyebrow">Summarize It</span>
        <h1>{operation?.videoTitle || state?.page?.title || 'YouTube → AI'}</h1>
      </header>

      {error && <div className="notice error" role="alert">{error}</div>}
      {captionsMissing && <div className="notice error" role="alert">Субтитры не найдены</div>}

      {operation ? (
        <OperationPanel
          operation={operation}
          autoOpening={busy && operation.status === 'prepared'}
          onOpen={() => void openPrepared()}
          onRetry={() => void runRecovery('retry')}
          onCopy={() => void runRecovery('copy')}
          onCancel={() => void runRecovery('cancel')}
        />
      ) : state?.page && !captionsMissing ? (
        <section className="controls">
          <label>
            <span>Язык суммаризации</span>
            <select aria-label="Язык суммаризации" value={state.summaryLanguage} disabled={busy} onChange={(event) => void changeLanguage(event.target.value)}>
              {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {state.page.tracks.length > 1 && (
            <label>
              <span>Субтитры</span>
              <select aria-label="Дорожка субтитров" value={selectedTrackId} disabled={busy} onChange={(event) => setSelectedTrackId(event.target.value)}>
                {state.page.tracks.map((track) => <option key={track.id} value={track.id}>{track.label}{track.kind === 'asr' ? ' · авто' : ''}</option>)}
              </select>
            </label>
          )}
          <div className="track-note">Источник: {selectedTrack?.label || 'выбранные субтитры'}</div>
          <div className="destination-grid">
            <button disabled={busy} onClick={() => void start('chatgpt')}>ChatGPT</button>
            <button disabled={busy} onClick={() => void start('perplexity')}>Perplexity</button>
          </div>
        </section>
      ) : null}

      <footer aria-live="polite"><span className={busy ? 'pulse' : ''} />{status}</footer>
    </main>
  );
}

function OperationPanel({ operation, autoOpening, onOpen, onRetry, onCopy, onCancel }: {
  operation: SummaryOperationState; autoOpening: boolean; onOpen: () => void; onRetry: () => void; onCopy: () => void; onCancel: () => void;
}) {
  const isPrepared = operation.status === 'prepared';
  const recoverable = operation.status === 'recoverable-error';
  return (
    <section className="operation-panel" aria-label="Текущая операция">
      <div className={`notice ${recoverable ? 'error' : 'info'}`}>{sizeMessage(operation)}</div>
      <p>{operation.statusMessage}</p>
      {isPrepared && (
        <button className="primary-action" disabled={autoOpening} onClick={onOpen}>
          {autoOpening ? `Открываем ${DESTINATION_NAMES[operation.destination]}…` : `Продолжить в ${DESTINATION_NAMES[operation.destination]}`}
        </button>
      )}
      {recoverable && <div className="recovery-actions"><button onClick={onRetry}>Повторить</button><button onClick={onCopy}>Скопировать запрос</button></div>}
      {canCancelOperation(operation) && <button className="text-action" onClick={onCancel}>Отменить</button>}
    </section>
  );
}

function sizeMessage(operation: Pick<SummaryOperationState, 'charLength' | 'estimatedTokens'>): string {
  const size = `${operation.charLength.toLocaleString()} знаков · ≈${operation.estimatedTokens.toLocaleString()} токенов`;
  return operation.estimatedTokens >= LARGE_PROMPT_WARNING_TOKENS ? `Очень большой запрос: ${size}` : size;
}
function getErrorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'Неизвестная ошибка'; }
function nextPaint(): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, 700)); }
