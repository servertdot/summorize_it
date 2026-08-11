import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PDF runtime boundary', () => {
  it('keeps PDF.js out of the extension service worker', () => {
    const backgroundEntry = readFileSync(resolve(process.cwd(), 'src/pages/background/index.ts'), 'utf8');

    expect(backgroundEntry).not.toContain('pdf-summary-service');
  });
});
