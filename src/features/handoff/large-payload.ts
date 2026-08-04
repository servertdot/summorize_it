import { OPERATION_TTL_MS } from '@src/shared/operation-policy';

export type AiDestination = 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'qwen' | 'deepseek';

export interface KeyValueStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface StoredOperation {
  id: string;
  destination: AiDestination;
  chunkCount: number;
  charLength: number;
  checksum: string;
  createdAt: number;
  expiresAt: number;
}

interface LargePayloadOptions {
  chunkSize: number;
  createId: () => string;
  now: () => number;
  ttlMs: number;
}

const DEFAULT_OPTIONS: LargePayloadOptions = {
  chunkSize: 64 * 1024,
  createId: () => crypto.randomUUID(),
  now: () => Date.now(),
  ttlMs: OPERATION_TTL_MS,
};
const STORAGE_BATCH_SIZE = 8;

export class LargePayloadStore {
  private readonly options: LargePayloadOptions;

  constructor(
    private readonly storage: KeyValueStorage,
    options: Partial<LargePayloadOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async save(prompt: string, destination: AiDestination): Promise<StoredOperation> {
    const id = this.options.createId();
    const chunks = chunkString(prompt, this.options.chunkSize);
    const createdAt = this.options.now();
    const operation: StoredOperation = {
      id,
      destination,
      chunkCount: chunks.length,
      charLength: prompt.length,
      checksum: payloadChecksum(prompt),
      createdAt,
      expiresAt: createdAt + this.options.ttlMs,
    };
    const writtenKeys: string[] = [];
    try {
      for (let offset = 0; offset < chunks.length; offset += STORAGE_BATCH_SIZE) {
        const entries: Record<string, unknown> = {};
        chunks.slice(offset, offset + STORAGE_BATCH_SIZE).forEach((chunk, index) => {
          const key = chunkKey(id, offset + index);
          entries[key] = chunk;
          writtenKeys.push(key);
        });
        await this.storage.set(entries);
      }
      await this.storage.set({ [metaKey(id)]: operation });
    } catch (cause) {
      await this.storage.remove(writtenKeys);
      throw cause;
    }
    return operation;
  }

  async read(id: string): Promise<string> {
    const operation = await this.getOperation(id);
    if (operation.expiresAt <= this.options.now()) {
      await this.complete(id);
      throw new Error('Operation expired');
    }

    const keys = Array.from({ length: operation.chunkCount }, (_, index) => chunkKey(id, index));
    const chunks: string[] = [];
    for (let offset = 0; offset < keys.length; offset += STORAGE_BATCH_SIZE) {
      const batchKeys = keys.slice(offset, offset + STORAGE_BATCH_SIZE);
      const storedChunks = await this.storage.get(batchKeys);
      for (const key of batchKeys) {
        const chunk = storedChunks[key];
        if (typeof chunk !== 'string') throw new Error('Operation data is corrupted');
        chunks.push(chunk);
      }
    }
    const prompt = chunks.join('');
    if (prompt.length !== operation.charLength || payloadChecksum(prompt) !== operation.checksum) {
      throw new Error('Operation data is corrupted');
    }
    return prompt;
  }

  async complete(id: string): Promise<void> {
    const stored = await this.storage.get([metaKey(id)]);
    const operation = stored[metaKey(id)] as StoredOperation | undefined;
    const chunkKeys = operation
      ? Array.from({ length: operation.chunkCount }, (_, index) => chunkKey(id, index))
      : [];
    await this.storage.remove([metaKey(id), ...chunkKeys]);
  }

  async cancel(id: string): Promise<void> {
    await this.complete(id);
  }

  private async getOperation(id: string): Promise<StoredOperation> {
    const stored = await this.storage.get([metaKey(id)]);
    const operation = stored[metaKey(id)];
    if (!isStoredOperation(operation)) throw new Error('Operation not found');
    return operation;
  }
}

function chunkString(value: string, chunkSize: number): string[] {
  if (chunkSize < 1) throw new Error('Chunk size must be positive');
  if (value.length === 0) return [''];
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(value.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function payloadChecksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function metaKey(id: string): string {
  return `summary:${id}:meta`;
}

function chunkKey(id: string, index: number): string {
  return `summary:${id}:chunk:${index}`;
}

function isStoredOperation(value: unknown): value is StoredOperation {
  if (!value || typeof value !== 'object') return false;
  const operation = value as Partial<StoredOperation>;
  return typeof operation.id === 'string'
    && typeof operation.destination === 'string'
    && typeof operation.chunkCount === 'number'
    && typeof operation.charLength === 'number'
    && typeof operation.checksum === 'string'
    && typeof operation.expiresAt === 'number';
}
