import { runDestinationDelivery } from './destination-content';
import { registerHtmlContent } from './html-content';
import { registerYouTubeContent } from './youtube-content';

if (location.hostname === 'www.youtube.com' && location.pathname === '/watch') {
  registerYouTubeContent();
} else if (location.hostname === 'chatgpt.com' || location.hostname === 'chat.openai.com') {
  void runDestinationDelivery('chatgpt');
} else if (location.hostname === 'perplexity.ai' || location.hostname === 'www.perplexity.ai') {
  void runDestinationDelivery('perplexity');
} else if (location.hostname === 'claude.ai') {
  void runDestinationDelivery('claude');
} else if (location.hostname === 'gemini.google.com') {
  void runDestinationDelivery('gemini');
} else if (location.hostname === 'chat.qwen.ai') {
  void runDestinationDelivery('qwen');
} else if (location.hostname === 'chat.deepseek.com') {
  void runDestinationDelivery('deepseek');
} else {
  registerHtmlContent();
}
