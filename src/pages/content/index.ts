import { runDestinationDelivery } from './destination-content';
import { registerYouTubeContent } from './youtube-content';

if (location.hostname === 'www.youtube.com') {
  registerYouTubeContent();
} else if (location.hostname === 'chatgpt.com' || location.hostname === 'chat.openai.com') {
  void runDestinationDelivery('chatgpt');
} else if (location.hostname === 'perplexity.ai' || location.hostname === 'www.perplexity.ai') {
  void runDestinationDelivery('perplexity');
}
