import { summaryLanguageName, type SummarySourceType } from './summary-service';

const YOUTUBE_PROMPT_COPY: Record<string, {
  instruction: string;
  details: string;
  responseLanguage: string;
  language: string;
}> = {
  en: { instruction: 'Create a structured summary of this YouTube video.', details: 'Highlight the main points, important details, and conclusions. When referring to fragments, use timestamps from the transcript.', responseLanguage: 'Response language', language: 'English' },
  ru: { instruction: 'Сделай структурированную суммаризацию этого YouTube-видео.', details: 'Выдели основные тезисы, важные детали и выводы. При ссылках на фрагменты используй таймкоды из расшифровки.', responseLanguage: 'Язык ответа', language: 'русский' },
  uk: { instruction: 'Створи структурований підсумок цього YouTube-відео.', details: 'Виділи головні тези, важливі деталі та висновки. Для посилань на фрагменти використовуй таймкоди з розшифровки.', responseLanguage: 'Мова відповіді', language: 'українська' },
  de: { instruction: 'Erstelle eine strukturierte Zusammenfassung dieses YouTube-Videos.', details: 'Hebe die wichtigsten Aussagen, Details und Schlussfolgerungen hervor. Verwende bei Verweisen die Zeitstempel aus dem Transkript.', responseLanguage: 'Antwortsprache', language: 'Deutsch' },
  es: { instruction: 'Crea un resumen estructurado de este video de YouTube.', details: 'Destaca las ideas principales, los detalles importantes y las conclusiones. Usa las marcas de tiempo de la transcripción al citar fragmentos.', responseLanguage: 'Idioma de respuesta', language: 'español' },
  fr: { instruction: 'Crée un résumé structuré de cette vidéo YouTube.', details: 'Mets en évidence les idées principales, les détails importants et les conclusions. Utilise les horodatages de la transcription pour citer des passages.', responseLanguage: 'Langue de réponse', language: 'français' },
  it: { instruction: 'Crea un riepilogo strutturato di questo video YouTube.', details: 'Evidenzia i punti principali, i dettagli importanti e le conclusioni. Usa i timestamp della trascrizione quando citi i passaggi.', responseLanguage: 'Lingua della risposta', language: 'italiano' },
  pt: { instruction: 'Crie um resumo estruturado deste vídeo do YouTube.', details: 'Destaque os pontos principais, detalhes importantes e conclusões. Use os timestamps da transcrição ao citar trechos.', responseLanguage: 'Idioma da resposta', language: 'português' },
  ja: { instruction: 'このYouTube動画の構造化された要約を作成してください。', details: '主なポイント、重要な詳細、結論を示してください。箇所を参照するときは文字起こしのタイムコードを使用してください。', responseLanguage: '回答言語', language: '日本語' },
  ko: { instruction: '이 YouTube 동영상의 구조화된 요약을 작성하세요.', details: '핵심 요점, 중요한 세부 사항, 결론을 강조하세요. 구간을 언급할 때는 대본의 타임코드를 사용하세요.', responseLanguage: '응답 언어', language: '한국어' },
  zh: { instruction: '请为此 YouTube 视频创建结构化摘要。', details: '突出主要观点、重要细节和结论。引用片段时，请使用文字稿中的时间码。', responseLanguage: '回复语言', language: '中文' },
};

export function defaultSystemPrompt(sourceType: SummarySourceType, summaryLanguage: string): string {
  const languageCode = summaryLanguage.trim().replace(/_/g, '-').toLocaleLowerCase().split('-')[0];
  const language = summaryLanguageName(summaryLanguage);
  if (sourceType === 'youtube') {
    const copy = YOUTUBE_PROMPT_COPY[languageCode] ?? YOUTUBE_PROMPT_COPY.en;
    return [copy.instruction, copy.details, `${copy.responseLanguage}: ${copy.language}`].join('\n');
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
