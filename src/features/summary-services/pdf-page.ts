import type { SummarySource } from './summary-service';

export interface PdfPage extends SummarySource {
  type: 'pdf';
}

export function createPdfPage(url: string, title?: string): PdfPage {
  return { type: 'pdf', id: url, title: title?.trim() || pdfTitleFromUrl(url), url };
}

export function isLikelyPdfUrl(url: string): boolean {
  try { return /\.pdf$/i.test(new URL(url).pathname); } catch { return false; }
}

function pdfTitleFromUrl(url: string): string {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'PDF document');
    return filename.replace(/\.pdf$/i, '') || 'PDF document';
  } catch {
    return 'PDF document';
  }
}
