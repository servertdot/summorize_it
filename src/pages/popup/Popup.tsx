import { useEffect, useMemo, useState } from 'react';

import type { AiDestination } from '@src/features/handoff/large-payload';
import { canCancelOperation } from '@src/features/summary-operation/operation-coordinator';
import { selectCaptionTrack, type YouTubePage } from '@src/features/youtube-transcript/transcript-operation';
import { AI_DESTINATIONS, DESTINATION_NAMES } from '@src/shared/destinations';
import { LARGE_PROMPT_WARNING_TOKENS } from '@src/shared/operation-policy';
import { isRecoverableOperation, isTerminalOperation, type SummaryOperationState } from '@src/shared/operation-state';

interface PopupState {
  page?: YouTubePage;
  summaryLanguage: string;
  selectedDestinations: AiDestination[];
  operation?: SummaryOperationState;
}

export interface PopupClient {
  load(): Promise<PopupState>;
  saveSummaryLanguage(language: string): Promise<void>;
  saveDestinations(destinations: AiDestination[]): Promise<void>;
  prepare(destination: AiDestination, summaryLanguage: string, selectedTrackId?: string): Promise<SummaryOperationState>;
  open(operationId: string, destination: AiDestination): Promise<SummaryOperationState>;
  refresh(operationId: string): Promise<SummaryOperationState | undefined>;
  retry(operationId: string): Promise<SummaryOperationState>;
  cancel(operationId: string): Promise<void>;
  copy(operationId: string): Promise<void>;
}

const LANGUAGES = [
  ['ru', 'Russian'], ['en', 'English'], ['uk', 'Ukrainian'], ['de', 'German'],
  ['es', 'Spanish'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
] as const;

export default function Popup({ client }: { client: PopupClient }) {
  const [state, setState] = useState<PopupState | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>();
  const [status, setStatus] = useState('Checking video…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    client.load().then((loaded) => {
      if (!active) return;
      setState(loaded);
      setSelectedTrackId(loaded.page ? selectCaptionTrack(loaded.page)?.id : undefined);
      setStatus(loaded.operation?.statusMessage || 'Ready to summarize');
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

  const toggleDestination = async (destination: AiDestination) => {
    if (!state || busy) return;
    const selected = state.selectedDestinations.includes(destination);
    if (selected && state.selectedDestinations.length === 1) return;
    const selectedSet = new Set(state.selectedDestinations);
    if (selected) selectedSet.delete(destination);
    else selectedSet.add(destination);
    const selectedDestinations = AI_DESTINATIONS.filter((item) => selectedSet.has(item));
    setState({ ...state, selectedDestinations });
    await client.saveDestinations(selectedDestinations);
  };

  const start = async (destination: AiDestination) => {
    if (!state?.page || busy) return;
    setBusy(true);
    setError(undefined);
    setStatus('Retrieving the complete transcript…');
    try {
      const prepared = await client.prepare(destination, state.summaryLanguage, selectedTrackId);
      setState({ ...state, operation: prepared });
      setStatus(sizeMessage(prepared));
      await nextPaint();
      const opened = await client.open(prepared.id, prepared.destination);
      setState((current) => current ? { ...current, operation: opened } : current);
    } catch (cause) {
      setError(getErrorMessage(cause));
      setStatus('Operation stopped');
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
        setStatus('Complete prompt copied');
      } else if (action === 'cancel') {
        await client.cancel(operation.id);
        setState({ ...state, operation: { ...operation, status: 'cancelled', statusMessage: 'Operation cancelled' } });
        setStatus('Operation cancelled');
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
      {captionsMissing && <div className="notice error" role="alert">No captions found</div>}

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
            <span>Summary language</span>
            <select aria-label="Summary language" value={state.summaryLanguage} disabled={busy} onChange={(event) => void changeLanguage(event.target.value)}>
              {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {state.page.tracks.length > 1 && (
            <label>
              <span>Captions</span>
              <select aria-label="Caption track" value={selectedTrackId} disabled={busy} onChange={(event) => setSelectedTrackId(event.target.value)}>
                {state.page.tracks.map((track) => <option key={track.id} value={track.id}>{captionTrackLabel(track)}</option>)}
              </select>
            </label>
          )}
          <div className="track-note">Source: {selectedTrack ? captionTrackLabel(selectedTrack) : 'selected captions'}</div>
          <label>
            <span>AI services</span>
            <select
              aria-label="Choose visible AI services"
              value=""
              disabled={busy}
              onChange={(event) => {
                const destination = event.target.value as AiDestination;
                if (destination) void toggleDestination(destination);
              }}
            >
              <option value="">{state.selectedDestinations.length} visible · choose to show or hide</option>
              {AI_DESTINATIONS.map((destination) => {
                const selected = state.selectedDestinations.includes(destination);
                return (
                  <option
                    key={destination}
                    value={destination}
                    disabled={selected && state.selectedDestinations.length === 1}
                  >
                    {selected ? 'Hide' : 'Show'} {DESTINATION_NAMES[destination]}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="destination-grid">
            {state.selectedDestinations.map((destination) => (
              <button
                key={destination}
                aria-label={`Summarize with ${DESTINATION_NAMES[destination]}`}
                disabled={busy}
                onClick={() => void start(destination)}
              >
                {DESTINATION_NAMES[destination]}
              </button>
            ))}
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
    <section className="operation-panel" aria-label="Current operation">
      <div className={`notice ${recoverable ? 'error' : 'info'}`}>{sizeMessage(operation)}</div>
      <p>{operation.statusMessage}</p>
      {isPrepared && (
        <button className="primary-action" disabled={autoOpening} onClick={onOpen}>
          {autoOpening ? `Opening ${DESTINATION_NAMES[operation.destination]}…` : `Continue in ${DESTINATION_NAMES[operation.destination]}`}
        </button>
      )}
      {recoverable && <div className="recovery-actions"><button onClick={onRetry}>Retry</button><button onClick={onCopy}>Copy prompt</button></div>}
      {canCancelOperation(operation) && <button className="text-action" onClick={onCancel}>Cancel</button>}
    </section>
  );
}

function sizeMessage(operation: Pick<SummaryOperationState, 'charLength' | 'estimatedTokens'>): string {
  const size = `${operation.charLength.toLocaleString()} characters · ≈${operation.estimatedTokens.toLocaleString()} tokens`;
  return operation.estimatedTokens >= LARGE_PROMPT_WARNING_TOKENS ? `Very large prompt: ${size}` : size;
}
function getErrorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unknown error'; }
function nextPaint(): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, 700)); }
function captionTrackLabel(track: YouTubePage['tracks'][number]): string {
  let language = track.languageCode;
  try {
    language = new Intl.DisplayNames(['en'], { type: 'language' }).of(track.languageCode) || language;
  } catch {
    // Keep the language code when YouTube provides an unknown value.
  }
  return `${language}${track.kind === 'asr' ? ' · auto-generated' : ''}`;
}
