import { describe, expect, it } from 'vitest';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs';

import { createPdfPage, isLikelyPdfUrl } from './pdf-page';
import { composePdfSummaryPrompt, pdfSummaryService, supportsPdfExtractionRuntime } from './pdf-summary-service';

(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

describe('PDF summary service', () => {
  it('rejects the service-worker runtime used by the extension background', () => {
    expect(supportsPdfExtractionRuntime({ self: {} })).toBe(false);
    expect(supportsPdfExtractionRuntime({ window: {} })).toBe(true);
  });

  it('recognizes PDF paths without relying on query parameters or letter case', () => {
    expect(isLikelyPdfUrl('https://example.com/report.PDF?download=1')).toBe(true);
    expect(isLikelyPdfUrl('https://example.com/report.pdf/preview')).toBe(false);
    expect(isLikelyPdfUrl('https://example.com/article')).toBe(false);
  });

  it('builds a page-aware prompt without truncating extracted text', () => {
    const page = createPdfPage('https://example.com/annual-report.pdf');
    const content = '[Page 1]\nRevenue grew.\n\n[Page 2]\nConclusion.';
    const prompt = composePdfSummaryPrompt(page, content, 'uk');

    expect(page.title).toBe('annual-report');
    expect(prompt).toContain('Write the summary in Ukrainian.');
    expect(prompt).toContain(content);
    expect(prompt).toContain('cite the page numbers');
  });

  it('uses a custom system prompt and still includes the extracted pages', () => {
    const page = createPdfPage('https://example.com/annual-report.pdf');
    const content = '[Page 1]\nRevenue grew.';
    const prompt = composePdfSummaryPrompt(page, content, 'uk', 'Write a B1-B2 English summary for a Russian learner.');

    expect(prompt).toContain('Write a B1-B2 English summary for a Russian learner.');
    expect(prompt).not.toContain('Write the summary in Ukrainian.');
    expect(prompt).toContain(content);
  });

  it('extracts text through PDF.js and preserves the page marker', async () => {
    const bytes = new TextEncoder().encode(createTextPdf('Hello from a real PDF page.'));
    const prepared = await pdfSummaryService.prepare({
      data: bytes.buffer as ArrayBuffer,
      url: 'https://example.com/sample.pdf',
      summaryLanguage: 'en',
    });

    expect(prepared.source).toMatchObject({ type: 'pdf', title: 'sample' });
    expect(prepared.prompt).toContain('[Page 1]');
    expect(prepared.prompt).toContain('Hello from a real PDF page.');
  });
});

function createTextPdf(text: string): string {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}
