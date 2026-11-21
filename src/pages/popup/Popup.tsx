import { useEffect, useMemo, useState } from 'react';

import type { AiDestination } from '@src/features/handoff/large-payload';
import { canCancelOperation } from '@src/features/summary-operation/operation-coordinator';
import { defaultSystemPrompt, sourceContentInsertionHint } from '@src/features/summary-services/summary-prompt';
import { isYouTubePage, selectCaptionTrack, type YouTubePage } from '@src/features/youtube-transcript/transcript-operation';
import { AI_DESTINATIONS, DESTINATION_NAMES } from '@src/shared/destinations';
import type { PromptSizeEstimate } from '@src/shared/messages';
import { LARGE_PROMPT_WARNING_TOKENS } from '@src/shared/operation-policy';
import { isRecoverableOperation, isTerminalOperation, type SummaryOperationState } from '@src/shared/operation-state';
import { summaryPageType, type SummaryPage } from '@src/shared/summary-page';

interface PopupState {
  page?: SummaryPage;
  summaryLanguage: string;
  systemPrompt: string;
  systemPromptEnabled: boolean;
  selectedDestinations: AiDestination[];
  operation?: SummaryOperationState;
}

export interface PopupClient {
  load(): Promise<PopupState>;
  saveSummaryLanguage(language: string): Promise<void>;
  saveSystemPrompt(systemPrompt: string): Promise<void>;
  saveSystemPromptEnabled(enabled: boolean): Promise<void>;
  saveDestinations(destinations: AiDestination[]): Promise<void>;
  estimatePromptSize(summaryLanguage: string, page: SummaryPage, selectedTrackId?: string, systemPrompt?: string): Promise<PromptSizeEstimate>;
  prepare(destination: AiDestination, summaryLanguage: string, page: SummaryPage, selectedTrackId?: string, systemPrompt?: string): Promise<SummaryOperationState>;
  open(operationId: string, destination: AiDestination): Promise<SummaryOperationState>;
  refresh(operationId: string): Promise<SummaryOperationState | undefined>;
  retry(operationId: string): Promise<SummaryOperationState>;
  cancel(operationId: string): Promise<void>;
  copy(operationId: string): Promise<void>;
  copyContent(page: SummaryPage, selectedTrackId?: string): Promise<void>;
}

const LANGUAGES = [
  ['ru', 'Russian'], ['en', 'English'], ['uk', 'Ukrainian'], ['de', 'German'],
  ['es', 'Spanish'], ['fr', 'French'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
] as const;

export default function Popup({ client }: { client: PopupClient }) {
  const [state, setState] = useState<PopupState | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string>();
  const [status, setStatus] = useState('Reading source…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | { error: string }>('idle');
  const [promptSize, setPromptSize] = useState<PromptSizeEstimate | null>(null);
  const [estimatingSize, setEstimatingSize] = useState(false);

  useEffect(() => {
    let active = true;
    client.load().then((loaded) => {
      if (!active) return;
      setState(loaded);
      setSelectedTrackId(loaded.page && isYouTubePage(loaded.page) ? selectCaptionTrack(loaded.page)?.id : undefined);
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

  const youtubePage = state?.page && isYouTubePage(state.page) ? state.page : undefined;
  const selectedTrack = useMemo(
    () => youtubePage?.tracks.find((track) => track.id === selectedTrackId),
    [selectedTrackId, youtubePage],
  );
  const captionsMissing = youtubePage?.tracks.length === 0;
  const operation = state?.operation;
  const title = operation?.source.title || state?.page?.title || 'Summarize It';
  const footerSize = operation ?? promptSize;
  const controlsDisabled = busy || copyState === 'copying';
  const copyError = typeof copyState === 'object' ? copyState.error : undefined;
  const copyLabel = copyState === 'copying' ? 'Copying…'
    : copyState === 'copied' ? 'Copied'
    : copyError ? 'Copy failed' : 'Copy content';

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const timeout = window.setTimeout(() => setCopyState('idle'), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    if (!state?.page || captionsMissing || operation || busy) {
      if (operation) setPromptSize({ charLength: operation.charLength, estimatedTokens: operation.estimatedTokens });
      return undefined;
    }
    let active = true;
    setEstimatingSize(true);
    const systemPrompt = state.systemPromptEnabled ? state.systemPrompt || undefined : undefined;
    void client.estimatePromptSize(state.summaryLanguage, state.page, selectedTrackId, systemPrompt)
      .then((estimate) => {
        if (!active) return;
        setPromptSize(estimate);
        setEstimatingSize(false);
      })
      .catch(() => {
        if (!active) return;
        setPromptSize(null);
        setEstimatingSize(false);
      });
    return () => { active = false; };
  }, [
    busy,
    captionsMissing,
    client,
    operation,
    selectedTrackId,
    state?.page,
    state?.summaryLanguage,
    state?.systemPrompt,
    state?.systemPromptEnabled,
  ]);

  const changeLanguage = async (language: string) => {
    if (!state) return;
    setState({ ...state, summaryLanguage: language });
    await client.saveSummaryLanguage(language);
  };

  const changeSystemPrompt = async (value: string) => {
    if (!state?.page) return;
    const defaultPrompt = defaultSystemPrompt(summaryPageType(state.page), state.summaryLanguage);
    const systemPrompt = value === defaultPrompt ? '' : value;
    setState({ ...state, systemPrompt });
    await client.saveSystemPrompt(systemPrompt);
  };

  const toggleSystemPrompt = async (enabled: boolean) => {
    if (!state) return;
    setState({ ...state, systemPromptEnabled: enabled });
    await client.saveSystemPromptEnabled(enabled);
  };

  const resetSystemPrompt = async () => {
    if (!state) return;
    setState({ ...state, systemPrompt: '' });
    await client.saveSystemPrompt('');
  };

  const toggleDestination = async (destination: AiDestination) => {
    if (!state || controlsDisabled) return;
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
    if (!state?.page || controlsDisabled) return;
    setBusy(true);
    setError(undefined);
    setStatus(preparationMessage(state.page));
    try {
      const prepared = await client.prepare(
        destination,
        state.summaryLanguage,
        state.page,
        selectedTrackId,
        state.systemPromptEnabled ? state.systemPrompt || undefined : undefined,
      );
      setState({ ...state, operation: prepared });
      setStatus(prepared.statusMessage);
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

  const copyContent = async () => {
    if (!state?.page || controlsDisabled) return;
    setCopyState('copying');
    try {
      await client.copyContent(state.page, selectedTrackId);
      setCopyState('copied');
    } catch (cause) {
      setCopyState({ error: getErrorMessage(cause) });
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
      <header className="menu-header">
        <h1 title={title}>{title}</h1>
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
        <>
          <section className="menu-section settings-panel" aria-label="Prompt settings">
            <label className="menu-row select-row">
              <span className="row-icon" aria-hidden="true"><Icon name="language" /></span>
              <span className="row-copy">
                <span className="row-title">Summary language</span>
              </span>
              <span className="row-meta">{languageLabel(state.summaryLanguage)}</span>
              <span className="row-chevron" aria-hidden="true"><Icon name="chevronDown" /></span>
              <select aria-label="Summary language" value={state.summaryLanguage} disabled={controlsDisabled} onChange={(event) => void changeLanguage(event.target.value)}>
                {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <SystemPromptEditor
              page={state.page}
              summaryLanguage={state.summaryLanguage}
              systemPrompt={state.systemPrompt}
              systemPromptEnabled={state.systemPromptEnabled}
              disabled={controlsDisabled}
              onChange={(value) => void changeSystemPrompt(value)}
              onToggle={(enabled) => void toggleSystemPrompt(enabled)}
              onReset={() => void resetSystemPrompt()}
            />
            {youtubePage && youtubePage.tracks.length > 0 && (
              <div className={`menu-row${youtubePage.tracks.length > 1 ? ' select-row' : ''}`}>
                <span className="row-icon" aria-hidden="true"><Icon name="captions" /></span>
                <span className="row-copy">
                  <span className="row-title">Captions</span>
                </span>
                <span className="row-meta">{selectedTrack ? captionTrackLabel(selectedTrack) : 'Select'}</span>
                {youtubePage.tracks.length > 1 && (
                  <>
                    <span className="row-chevron" aria-hidden="true"><Icon name="chevronDown" /></span>
                    <select aria-label="Caption track" value={selectedTrackId} disabled={controlsDisabled} onChange={(event) => setSelectedTrackId(event.target.value)}>
                      {youtubePage.tracks.map((track) => <option key={track.id} value={track.id}>{captionTrackLabel(track)}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}
          </section>

          <section className="menu-section destinations" aria-labelledby="destinations-heading">
            <h2 id="destinations-heading">Summarize with</h2>
            <div className="destination-grid">
              {state.selectedDestinations.map((destination) => (
                <button
                  type="button"
                  key={destination}
                  className="menu-row destination-row"
                  aria-label={`Summarize with ${DESTINATION_NAMES[destination]}`}
                  disabled={controlsDisabled}
                  onClick={() => void start(destination)}
                >
                  <span className="dest-avatar" data-destination={destination} aria-hidden="true" />
                  <span className="row-copy">{DESTINATION_NAMES[destination]}</span>
                  <span className="row-chevron" aria-hidden="true"><Icon name="external" /></span>
                </button>
              ))}
            </div>
            <div className="destination-actions">
              <label className="menu-row select-row service-picker">
                <span className="row-copy">Manage services</span>
                <span className="row-chevron" aria-hidden="true"><Icon name="chevronDown" /></span>
                <select
                  aria-label="Choose visible AI services"
                  value=""
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    const destination = event.target.value as AiDestination;
                    if (destination) void toggleDestination(destination);
                  }}
                >
                  <option value="">Manage services</option>
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
              <button
                type="button"
                className="menu-row copy-action"
                data-copied={copyState === 'copied' || undefined}
                disabled={controlsDisabled}
                title={copyError}
                onClick={() => void copyContent()}
              >
                <span className="row-icon" aria-hidden="true"><Icon name={copyState === 'copied' ? 'check' : 'copy'} /></span>
                {copyLabel}
              </button>
              <span className="copy-announcement" role="status">
                {copyState === 'copied' ? 'Content copied to the clipboard' : copyError}
              </span>
            </div>
          </section>
        </>
      ) : null}

      <footer aria-live="polite">
        <span className="status-message">
          <span className={`status-dot${busy || estimatingSize ? ' pulse' : ''}`} aria-hidden="true" />
          {status}
        </span>
        {footerSize ? (
          <span
            className={`status-size${footerSize.estimatedTokens >= LARGE_PROMPT_WARNING_TOKENS ? ' is-large' : ''}`}
            title={promptSizeTitle(footerSize)}
          >
            {promptSizeLabel(footerSize)}
          </span>
        ) : estimatingSize ? (
          <span className="status-size" title="Estimating prompt size">…</span>
        ) : null}
      </footer>
    </main>
  );
}

function SystemPromptEditor({ page, summaryLanguage, systemPrompt, systemPromptEnabled, disabled, onChange, onToggle, onReset }: {
  page: SummaryPage;
  summaryLanguage: string;
  systemPrompt: string;
  systemPromptEnabled: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
}) {
  const sourceType = summaryPageType(page);
  const defaultPrompt = defaultSystemPrompt(sourceType, summaryLanguage);
  const editorValue = systemPrompt || defaultPrompt;
  const isCustom = Boolean(systemPrompt);
  return (
    <details className="system-prompt">
      <summary className="menu-row">
        <span className="row-icon" aria-hidden="true"><Icon name="prompt" /></span>
        <span className="row-copy">
          <span className="row-title">System prompt</span>
        </span>
        <span className="row-meta">{systemPromptEnabled ? (isCustom ? 'Custom' : 'Default') : 'Off'}</span>
        <span className="row-chevron" aria-hidden="true"><Icon name="chevron" /></span>
      </summary>
      <label className="system-prompt-toggle">
        <input
          type="checkbox"
          aria-label="Use custom system prompt"
          checked={systemPromptEnabled}
          disabled={disabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        Use custom system prompt
      </label>
      <div className="system-prompt-editor">
        <textarea
          aria-label="System prompt"
          value={editorValue}
          disabled={disabled || !systemPromptEnabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="system-prompt-source">
          {systemPromptEnabled
            ? sourceContentInsertionHint(sourceType)
            : 'Disabled. The built-in summary prompt will be used.'}
        </div>
      </div>
      {isCustom && <button type="button" className="text-action" disabled={disabled} onClick={onReset}>Reset to default</button>}
    </details>
  );
}

function OperationPanel({ operation, autoOpening, onOpen, onRetry, onCopy, onCancel }: {
  operation: SummaryOperationState; autoOpening: boolean; onOpen: () => void; onRetry: () => void; onCopy: () => void; onCancel: () => void;
}) {
  const isPrepared = operation.status === 'prepared';
  const recoverable = operation.status === 'recoverable-error';
  const largePrompt = operation.estimatedTokens >= LARGE_PROMPT_WARNING_TOKENS;
  return (
    <section className="menu-section operation-panel" aria-label="Current operation">
      {largePrompt && (
        <div className="notice info">
          Very large prompt — some models may reject it
        </div>
      )}
      {recoverable ? (
        <div className="notice error">{operation.statusMessage}</div>
      ) : (
        <p>{operation.statusMessage}</p>
      )}
      {isPrepared && (
        <button className="menu-row primary-action" disabled={autoOpening} onClick={onOpen}>
          {autoOpening ? `Opening ${DESTINATION_NAMES[operation.destination]}…` : `Continue in ${DESTINATION_NAMES[operation.destination]}`}
        </button>
      )}
      {recoverable && (
        <div className="recovery-actions">
          <button className="menu-row" onClick={onRetry}>Retry</button>
          <button className="menu-row" onClick={onCopy}>Copy prompt</button>
        </div>
      )}
      {canCancelOperation(operation) && <button className="menu-row text-action" onClick={onCancel}>Cancel</button>}
    </section>
  );
}

/** Compact footer metric; full values live in the title tooltip. */
function promptSizeLabel(operation: Pick<SummaryOperationState, 'charLength' | 'estimatedTokens'>): string {
  return `${formatCompactCount(operation.charLength)} chars · ≈${formatCompactCount(operation.estimatedTokens)} tok`;
}

function promptSizeTitle(operation: Pick<SummaryOperationState, 'charLength' | 'estimatedTokens'>): string {
  return `${operation.charLength.toLocaleString()} characters · ≈${operation.estimatedTokens.toLocaleString()} tokens`;
}

function formatCompactCount(value: number): string {
  if (value < 10_000) return value.toLocaleString();
  if (value < 1_000_000) {
    const thousands = value / 1_000;
    const rounded = Number(thousands.toFixed(thousands >= 100 ? 0 : 1));
    return `${rounded.toLocaleString()}k`;
  }
  return `${Number((value / 1_000_000).toFixed(1)).toLocaleString()}M`;
}
function getErrorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : 'Unknown error'; }
function nextPaint(): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, 700)); }
function preparationMessage(page: SummaryPage): string {
  const type = summaryPageType(page);
  if (type === 'youtube') return 'Retrieving the complete transcript…';
  if (type === 'pdf') return 'Extracting the complete PDF text…';
  return 'Extracting the main page content…';
}
function captionTrackLabel(track: YouTubePage['tracks'][number]): string {
  let language = track.languageCode;
  try {
    language = new Intl.DisplayNames(['en'], { type: 'language' }).of(track.languageCode) || language;
  } catch {
    // Keep the language code when YouTube provides an unknown value.
  }
  return `${language}${track.kind === 'asr' ? ' · auto-generated' : ''}`;
}

function languageLabel(code: string): string {
  return LANGUAGES.find(([value]) => value === code)?.[1] ?? code;
}

function Icon({ name }: { name: 'language' | 'captions' | 'prompt' | 'external' | 'chevron' | 'chevronDown' | 'copy' | 'check' }) {
  const common = {
    viewBox: '0 0 16 16',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  if (name === 'copy') {
    return (
      <svg {...common}>
        <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" />
        <path d="M3 10.25H2.75a1 1 0 0 1-1-1v-6.5a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1V3" />
      </svg>
    );
  }
  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="m3 8 3.25 3.25L13 4.5" />
      </svg>
    );
  }
  if (name === 'language') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M1.75 8h12.5M8 1.75c-2.15 1.85-3.2 4.05-3.2 6.25S5.85 12.4 8 14.25c2.15-1.85 3.2-4.05 3.2-6.25S10.15 3.6 8 1.75Z" />
      </svg>
    );
  }
  if (name === 'captions') {
    return (
      <svg {...common}>
        <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.5" />
        <path d="M4.25 8.25h2.5M9.25 8.25h2.5" />
      </svg>
    );
  }
  if (name === 'prompt') {
    return (
      <svg {...common}>
        <path d="M3.25 12.75 4.7 9.4 11.6 2.5a1.6 1.6 0 0 1 2.26 2.26L6.96 11.66l-3.71 1.09Z" />
      </svg>
    );
  }
  if (name === 'external') {
    return (
      <svg {...common}>
        <path d="M4.75 11.25l6.5-6.5M5.5 4.75h5.75v5.75" />
      </svg>
    );
  }
  if (name === 'chevron') {
    return (
      <svg {...common}>
        <path d="m6 3.75 4 4.25-4 4.25" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m3.75 6 4.25 4 4.25-4" />
    </svg>
  );
}
