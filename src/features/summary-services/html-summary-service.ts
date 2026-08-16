import { Readability } from '@mozilla/readability';

import {
  composePreparedPrompt,
  resolveSystemPrompt,
  sourceContentHeading,
} from './summary-prompt';
import type { SummaryService, SummarySource } from './summary-service';

export interface HtmlPage extends SummarySource {
  type: 'html';
}

export interface HtmlSummaryInput {
  document: Document;
  url: string;
  summaryLanguage: string;
  systemPrompt?: string;
}

export const htmlSummaryService: SummaryService<HtmlSummaryInput> = {
  async prepare({ document, url, summaryLanguage, systemPrompt }) {
    const page = readHtmlPage(document, url);
    const article = new Readability(document.cloneNode(true) as Document).parse();
    const content = normalizeText(article?.textContent || fallbackPageText(document));
    if (!content) throw new Error('Could not find readable text on this page');

    return {
      source: page,
      prompt: composeHtmlSummaryPrompt(page, content, summaryLanguage, article?.byline, systemPrompt),
    };
  },
};

export function readHtmlPage(document: Document, url: string): HtmlPage {
  const canonicalUrl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || url;
  const title = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content.trim()
    || document.title.trim()
    || new URL(url).hostname;
  return { type: 'html', id: canonicalUrl, title, url: canonicalUrl };
}

export function composeHtmlSummaryPrompt(
  page: HtmlPage,
  content: string,
  summaryLanguage: string,
  byline?: string | null,
  systemPrompt?: string,
): string {
  return composePreparedPrompt({
    systemPrompt: resolveSystemPrompt('html', summaryLanguage, systemPrompt),
    title: page.title,
    url: page.url,
    extraLines: byline?.trim() ? [`Author: ${byline.trim()}`] : undefined,
    contentHeading: sourceContentHeading('html'),
    content,
  });
}

function fallbackPageText(document: Document): string {
  const root = document.querySelector('article, main, [role="main"]') || document.body;
  if (!root) return '';
  const readableRoot = root.cloneNode(true) as Element;
  readableRoot.querySelectorAll('script, style, noscript, template, svg, nav, footer, header, form').forEach((element) => element.remove());
  return readableRoot.textContent || '';
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
