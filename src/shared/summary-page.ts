import { type HtmlPage } from '@src/features/summary-services/html-summary-service';
import { type PdfPage } from '@src/features/summary-services/pdf-page';
import { isSummarySource } from '@src/features/summary-services/summary-service';
import { isYouTubePage, type YouTubePage } from '@src/features/youtube-transcript/transcript-operation';

export type SummaryPage = YouTubePage | HtmlPage | PdfPage;

export function isSummaryPage(value: unknown): value is SummaryPage {
  return isYouTubePage(value) || (isSummarySource(value) && (value.type === 'html' || value.type === 'pdf'));
}

export function summaryPageType(page: SummaryPage): 'youtube' | 'html' | 'pdf' {
  return isYouTubePage(page) ? 'youtube' : page.type;
}

export function summaryPageTitle(page: SummaryPage): string {
  return page.title;
}
