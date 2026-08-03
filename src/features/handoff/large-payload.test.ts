import { describe, expect, it } from 'vitest';

import { LargePayloadStore, type KeyValueStorage } from './large-payload';

class MemoryStorage implements KeyValueStorage {
  readonly values = new Map<string, unknown>();

  async get(keys: string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.filter((key) => this.values.has(key)).map((key) => [key, this.values.get(key)]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.entries(items).forEach(([key, value]) => this.values.set(key, value));
  }

  async remove(keys: string[]): Promise<void> {
    keys.forEach((key) => this.values.delete(key));
  }
}

class LimitedStorage extends MemoryStorage {
  override async get(keys: string[]): Promise<Record<string, unknown>> {
    if (keys.length > 8) throw new Error('storage read batch too large');
    return super.get(keys);
  }

  override async set(items: Record<string, unknown>): Promise<void> {
    if (Object.keys(items).length > 8) throw new Error('storage write batch too large');
    return super.set(items);
  }
}

describe('large payload handoff', () => {
  it('reassembles a long Unicode prompt exactly once and removes it after completion', async () => {
    const storage = new MemoryStorage();
    const handoff = new LargePayloadStore(storage, {
      chunkSize: 7,
      createId: () => 'operation-1',
      now: () => 1_000,
      ttlMs: 30 * 60 * 1_000,
    });
    const prompt = 'Начало 🚀 — middle — 終わり'.repeat(20);

    const saved = await handoff.save(prompt, 'chatgpt');

    expect(saved).toMatchObject({
      id: 'operation-1',
      destination: 'chatgpt',
      charLength: prompt.length,
      expiresAt: 1_801_000,
    });
    expect(saved.chunkCount).toBeGreaterThan(1);
    await expect(handoff.read('operation-1')).resolves.toBe(prompt);

    await handoff.complete('operation-1');

    await expect(handoff.read('operation-1')).rejects.toThrow('Операция не найдена');
    expect(storage.values.size).toBe(0);
  });

  it('rejects a payload when a chunk is missing instead of returning partial text', async () => {
    const storage = new MemoryStorage();
    const handoff = new LargePayloadStore(storage, {
      chunkSize: 4,
      createId: () => 'operation-2',
      now: () => 1_000,
      ttlMs: 30 * 60 * 1_000,
    });
    await handoff.save('complete payload', 'perplexity');
    storage.values.delete('summary:operation-2:chunk:1');

    await expect(handoff.read('operation-2')).rejects.toThrow('Данные операции повреждены');
  });

  it('moves a multi-megabyte prompt without oversized storage operations', async () => {
    const storage = new LimitedStorage();
    const handoff = new LargePayloadStore(storage, {
      chunkSize: 64 * 1024,
      createId: () => 'large-operation',
      now: () => 1_000,
      ttlMs: 30 * 60 * 1_000,
    });
    const prompt = 'абв🚀'.repeat(700_000);

    await handoff.save(prompt, 'chatgpt');

    await expect(handoff.read('large-operation')).resolves.toBe(prompt);
  });

  it('cancels one operation without touching another parallel operation', async () => {
    const storage = new MemoryStorage();
    let id = 0;
    const handoff = new LargePayloadStore(storage, { createId: () => `operation-${++id}` });
    const first = await handoff.save('first', 'chatgpt');
    const second = await handoff.save('second', 'perplexity');

    await handoff.cancel(first.id);

    await expect(handoff.read(first.id)).rejects.toThrow('Операция не найдена');
    await expect(handoff.read(second.id)).resolves.toBe('second');
  });

  it('removes an expired operation at the shared TTL boundary', async () => {
    const storage = new MemoryStorage();
    let now = 1_000;
    const handoff = new LargePayloadStore(storage, { createId: () => 'expiring', now: () => now });
    const saved = await handoff.save('payload', 'chatgpt');
    now = saved.expiresAt;

    await expect(handoff.read(saved.id)).rejects.toThrow('Операция истекла');
    expect(storage.values.size).toBe(0);
  });
});
