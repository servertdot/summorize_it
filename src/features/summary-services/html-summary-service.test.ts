import { describe, expect, it } from 'vitest';

import { htmlSummaryService, readHtmlPage } from './html-summary-service';

describe('HTML summary service', () => {
  it('extracts the main article and excludes surrounding navigation', async () => {
    document.documentElement.innerHTML = `
      <head>
        <title>Readable article</title>
        <link rel="canonical" href="https://example.com/article">
      </head>
      <body>
        <nav>Unrelated navigation</nav>
        <article>
          <h1>Readable article</h1>
          <p>This is the central argument with enough meaningful article text for extraction.</p>
          <p>The conclusion contains an important number: 42.</p>
        </article>
        <footer>Unrelated footer</footer>
      </body>`;

    const prepared = await htmlSummaryService.prepare({
      document,
      url: 'https://example.com/article?tracking=yes',
      summaryLanguage: 'ru',
    });

    expect(prepared.source).toEqual({
      type: 'html', id: 'https://example.com/article', title: 'Readable article', url: 'https://example.com/article',
    });
    expect(prepared.prompt).toContain('Write the summary in Russian.');
    expect(prepared.prompt).toContain('central argument');
    expect(prepared.prompt).toContain('important number: 42');
    expect(prepared.prompt).not.toContain('Unrelated navigation');
    expect(prepared.prompt).not.toContain('Unrelated footer');
  });

  it('uses a custom system prompt without replacing the extracted page content', async () => {
    document.documentElement.innerHTML = `
      <head><title>Readable article</title></head>
      <body><article><p>This is the central argument with enough meaningful article text for extraction.</p></article></body>`;

    const prepared = await htmlSummaryService.prepare({
      document,
      url: 'https://example.com/article',
      summaryLanguage: 'ru',
      systemPrompt: 'Write a B1-B2 English summary for a Russian learner.',
    });

    expect(prepared.prompt).toContain('Write a B1-B2 English summary for a Russian learner.');
    expect(prepared.prompt).not.toContain('Write the summary in Russian.');
    expect(prepared.prompt).toContain('central argument');
  });

  it('describes a page before the full content is extracted', () => {
    document.documentElement.innerHTML = '<head><title>Page title</title></head><body />';
    expect(readHtmlPage(document, 'https://example.com/page')).toMatchObject({
      type: 'html', title: 'Page title', url: 'https://example.com/page',
    });
  });
});
