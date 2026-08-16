import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import {
  composePreparedPrompt,
  resolveSystemPrompt,
  sourceContentHeading,
} from './summary-prompt';
import type { SummaryService } from './summary-service';
import { createPdfPage, type PdfPage } from './pdf-page';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfSummaryInput {
  data: ArrayBuffer;
  url: string;
  title?: string;
  summaryLanguage: string;
  systemPrompt?: string;
}

export const pdfSummaryService: SummaryService<PdfSummaryInput> = {
  async prepare({ data, url, title, summaryLanguage, systemPrompt }) {
    if (!supportsPdfExtractionRuntime(globalThis)) {
      throw new Error('PDF extraction requires an extension page context');
    }
    const document = await getDocument({ data: new Uint8Array(data) }).promise;
    try {
      const metadata = await document.getMetadata().catch(() => undefined);
      const metadataTitle = readMetadataTitle(metadata?.info);
      const page = createPdfPage(url, metadataTitle || title);
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const pdfPage = await document.getPage(pageNumber);
        const text = await pdfPage.getTextContent();
        const pageText = text.items.map((item) => {
          if (!('str' in item)) return '';
          return `${item.str}${item.hasEOL ? '\n' : ' '}`;
        }).join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
        if (pageText) pages.push(`[Page ${pageNumber}]\n${pageText}`);
      }
      if (pages.length === 0) throw new Error('This PDF does not contain extractable text');
      return { source: page, prompt: composePdfSummaryPrompt(page, pages.join('\n\n'), summaryLanguage, systemPrompt) };
    } finally {
      await document.destroy();
    }
  },
};

export function supportsPdfExtractionRuntime(scope: object): boolean {
  return 'window' in scope;
}

export function composePdfSummaryPrompt(page: PdfPage, content: string, summaryLanguage: string, systemPrompt?: string): string {
  return composePreparedPrompt({
    systemPrompt: resolveSystemPrompt('pdf', summaryLanguage, systemPrompt),
    title: page.title,
    url: page.url,
    contentHeading: sourceContentHeading('pdf'),
    content,
  });
}

function readMetadataTitle(info: unknown): string | undefined {
  if (!info || typeof info !== 'object' || !('Title' in info)) return undefined;
  const title = (info as { Title?: unknown }).Title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}
