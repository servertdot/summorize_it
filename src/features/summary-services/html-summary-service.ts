import { Readability } from '@mozilla/readability';

import {
  summaryLanguageName,
  type SummaryService,
  type SummarySource,
} from './summary-service';

export interface HtmlPage extends SummarySource {
  type: 'html';
}

export interface HtmlSummaryInput {
  document: Document;
  url: string;
  summaryLanguage: string;
}

export const htmlSummaryService: SummaryService<HtmlSummaryInput> = {
  async prepare({ document, url, summaryLanguage }) {
    const page = readHtmlPage(document, url);
    const article = new Readability(document.cloneNode(true) as Document).parse();
    const content = normalizeText(article?.textContent || fallbackPageText(document));
    if (!content) throw new Error('Could not find readable text on this page');

    return {
      source: page,
      prompt: composeHtmlSummaryPrompt(page, content, summaryLanguage, article?.byline),
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
): string {
  return [
    'Create a structured summary of this web page.',
    'Highlight the main points, important details, arguments, and conclusions. Preserve important names and numbers mentioned in the text.',
    `Write the summary in ${summaryLanguageName(summaryLanguage)}.`,
    '',
    `Title: ${page.title}`,
    `URL: ${page.url}`,
    ...(byline?.trim() ? [`Author: ${byline.trim()}`] : []),
    '',
    'Page content:',
    content,
  ].join('\n');
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
