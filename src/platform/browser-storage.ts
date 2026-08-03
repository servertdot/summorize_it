import browser from 'webextension-polyfill';

import type { KeyValueStorage } from '@src/features/handoff/large-payload';

export const browserLocalStorage: KeyValueStorage = {
  async get(keys) {
    return browser.storage.local.get(keys) as Promise<Record<string, unknown>>;
  },
  async set(items) {
    await browser.storage.local.set(items);
  },
  async remove(keys) {
    await browser.storage.local.remove(keys);
  },
};
