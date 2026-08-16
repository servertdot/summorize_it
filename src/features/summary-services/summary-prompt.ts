import { summaryLanguageName, type SummarySourceType } from './summary-service';

export function defaultSystemPrompt(sourceType: SummarySourceType, summaryLanguage: string): string {
  const language = summaryLanguageName(summaryLanguage);
  if (sourceType === 'youtube') {
    return [
      'Create a structured summary of this YouTube video.',
      'Highlight the main points, important details, and conclusions. When referring to specific moments, use timestamps from the transcript.',
      `Write the summary in ${language}.`,
    ].join('\n');
  }
  if (sourceType === 'html') {
    return [
      'Create a structured summary of this web page.',
      'Highlight the main points, important details, arguments, and conclusions. Preserve important names and numbers mentioned in the text.',
      `Write the summary in ${language}.`,
    ].join('\n');
  }
  return [
    'Create a structured summary of this PDF document.',
    'Highlight the main points, important details, arguments, and conclusions. When referring to specific material, cite the page numbers included in the extracted text.',
    `Write the summary in ${language}.`,
  ].join('\n');
}

export function resolveSystemPrompt(
  sourceType: SummarySourceType,
  summaryLanguage: string,
  customSystemPrompt?: string,
): string {
  return customSystemPrompt?.trim() || defaultSystemPrompt(sourceType, summaryLanguage);
}

export function sourceContentHeading(sourceType: SummarySourceType): string {
  if (sourceType === 'youtube') return 'Transcript';
  if (sourceType === 'html') return 'Page content';
  return 'Document content';
}

export function sourceContentInsertionHint(sourceType: SummarySourceType): string {
  if (sourceType === 'youtube') return 'The transcript is added automatically and is not shown while editing.';
  if (sourceType === 'html') return 'The page content is added automatically and is not shown while editing.';
  return 'The document content is added automatically and is not shown while editing.';
}

export function composePreparedPrompt(options: {
  systemPrompt: string;
  title: string;
  url: string;
  extraLines?: string[];
  contentHeading: string;
  content: string;
}): string {
  return [
    options.systemPrompt.trim(),
    '',
    `Title: ${options.title}`,
    `URL: ${options.url}`,
    ...(options.extraLines ?? []),
    '',
    `${options.contentHeading}:`,
    options.content,
  ].join('\n');
}
