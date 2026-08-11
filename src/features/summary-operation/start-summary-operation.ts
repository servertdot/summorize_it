import type { AiDestination, StoredOperation } from '@src/features/handoff/large-payload';
import type { PreparedSourceSummary, SummarySource } from '@src/features/summary-services/summary-service';

interface StartSummaryOperationInput {
  destination: AiDestination;
  prepare: () => Promise<PreparedSourceSummary>;
  save: (prompt: string, destination: AiDestination) => Promise<StoredOperation>;
}

export interface StartedSummaryOperation {
  operationId: string;
  destination: AiDestination;
  source: SummarySource;
  variantId?: string;
  charLength: number;
  estimatedTokens: number;
  expiresAt: number;
}

export async function startSummaryOperation({
  destination,
  prepare,
  save,
}: StartSummaryOperationInput): Promise<StartedSummaryOperation> {
  const prepared = await prepare();
  const operation = await save(prepared.prompt, destination);
  return {
    operationId: operation.id,
    destination,
    source: prepared.source,
    variantId: prepared.variantId,
    charLength: prepared.prompt.length,
    estimatedTokens: Math.ceil(prepared.prompt.length / 4),
    expiresAt: operation.expiresAt,
  };
}
