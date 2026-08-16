import { describe, expect, it } from 'vitest';

import {
  composePreparedPrompt,
  defaultSystemPrompt,
  resolveSystemPrompt,
  sourceContentHeading,
} from './summary-prompt';

describe('summary prompt', () => {
  it('keeps source-specific default instructions without the inserted content', () => {
    expect(defaultSystemPrompt('youtube', 'en')).toContain('YouTube video');
    expect(defaultSystemPrompt('youtube', 'ru')).toContain('Write the summary in Russian.');
    expect(defaultSystemPrompt('youtube', 'en')).not.toContain('Transcript:');
    expect(defaultSystemPrompt('html', 'en')).not.toContain('Page content:');
  });

  it('uses a custom system prompt instead of the default instructions', () => {
    const prompt = composePreparedPrompt({
      systemPrompt: resolveSystemPrompt('youtube', 'ru', 'Write a B1-B2 English summary for a Russian learner.'),
      title: 'Video',
      url: 'https://www.youtube.com/watch?v=video',
      extraLines: ['Caption language: en'],
      contentHeading: sourceContentHeading('youtube'),
      content: '[0:00] Complete transcript.',
    });

    expect(prompt).toContain('Write a B1-B2 English summary for a Russian learner.');
    expect(prompt).not.toContain('Write the summary in Russian.');
    expect(prompt).toContain('Transcript:\n[0:00] Complete transcript.');
  });

  it('falls back to the default when the custom prompt is empty', () => {
    expect(resolveSystemPrompt('pdf', 'uk', '   ')).toBe(defaultSystemPrompt('pdf', 'uk'));
  });
});
