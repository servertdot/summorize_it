<p align="center">
  <img src="public/icon.svg" width="96" height="96" alt="Summarize It icon">
</p>

<h1 align="center">Summarize It</h1>

<p align="center">
  Prepare YouTube transcripts, web pages, and PDFs for your preferred AI assistant.
</p>

## What it does

Summarize It is a Chrome extension that turns the active YouTube video, web page, or PDF into a ready-to-send summarization request. It automatically chooses the matching extractor, opens a new conversation in your chosen AI service, inserts the full prompt, and verifies that nothing was truncated.

- Extracts available captions from regular public YouTube videos.
- Groups transcript segments into readable, timestamped blocks.
- Extracts the main readable content from HTML pages without surrounding navigation and ads.
- Extracts text from PDFs and keeps page numbers available for references.
- Preserves the complete extracted content without hidden shortening or truncation.
- Lets you choose the caption track and summary language.
- Supports ChatGPT, Perplexity, Claude, Gemini, Qwen, and DeepSeek through their web interfaces.
- Lets you choose which AI services appear as quick-action buttons.
- Leaves the complete prepared request in the editor for you to review and submit.

## How it works

1. Open a YouTube video with captions, a web page, or a text-based PDF.
2. Open Summarize It and choose which AI service buttons you want to see.
3. Select the language for the summary. YouTube videos also let you select the caption track.
4. Start the handoff, review the prepared request, and press Enter to submit it.

The extension opens a new conversation and inserts the complete prepared content. YouTube keeps timestamps and PDF documents keep page markers. Scanned image-only PDFs require OCR and are not currently supported.

## Privacy

Summarize It does not require API keys or its own backend. Content extraction and handoff coordination happen in the browser, and the prepared request is sent only to the AI service you select. Access to `file://` PDFs must be enabled separately for the extension in Chrome.

## Development

Requirements:

- Node.js 20
- Yarn 1

```sh
yarn install
yarn test
yarn typecheck
yarn build
```

## Install locally

1. Run `yarn build`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the generated `dist_chrome` directory.

Third-party MIT-licensed components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
