export const SUMMARY_SOURCE_TYPES = ['youtube', 'html', 'pdf'] as const;
export type SummarySourceType = typeof SUMMARY_SOURCE_TYPES[number];

export interface SummarySource {
  type: SummarySourceType;
  id: string;
  title: string;
  url: string;
}

export interface PreparedSourceSummary {
  source: SummarySource;
  prompt: string;
  variantId?: string;
}

export interface SummaryService<Input> {
  prepare(input: Input): Promise<PreparedSourceSummary>;
}

export function isSummarySource(value: unknown): value is SummarySource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<SummarySource>;
  return SUMMARY_SOURCE_TYPES.some((type) => type === source.type)
    && typeof source.id === 'string'
    && typeof source.title === 'string'
    && typeof source.url === 'string';
}

const SUMMARY_LANGUAGE_NAMES: Record<string, string> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  uk: 'Ukrainian',
  zh: 'Chinese',
};

export function summaryLanguageName(language: string): string {
  const languageCode = language.trim().replace(/_/g, '-').toLocaleLowerCase().split('-')[0];
  return SUMMARY_LANGUAGE_NAMES[languageCode] ?? language;
}
