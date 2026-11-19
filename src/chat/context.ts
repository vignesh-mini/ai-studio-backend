import type { ChatTurn } from '../ai-gateway/openai-compatible.js';
import type { ChatMessageDto } from './chat.dto.js';

export const SYSTEM_PROMPT =
  'You are AI Studio, a helpful assistant. Answer clearly and concisely. Use Markdown for structure and fenced code blocks for code.';

/** Rough budget that fits every model in the initial catalogue with room for the reply. */
export const MAX_CONTEXT_CHARS = 24_000;

/**
 * Converts the app's history into provider-neutral turns. Replies from other models
 * become plain assistant turns, which is what makes switching models mid-conversation
 * work. Oldest turns are dropped first when the history exceeds the budget.
 */
export function buildContext(
  messages: ChatMessageDto[],
  maxChars = MAX_CONTEXT_CHARS,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const files = message.attachments?.map((a) => a.name).filter(Boolean) ?? [];
    const content = files.length
      ? `${message.content}\n\n[Attached files: ${files.join(', ')}]`
      : message.content;

    const isLatest = i === messages.length - 1;
    if (!isLatest && used + content.length > maxChars) break;
    used += content.length;
    turns.unshift({ role: message.role, content });
  }

  return [{ role: 'system', content: SYSTEM_PROMPT }, ...turns];
}

export const titleFrom = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60
    ? `${clean.slice(0, 59).trimEnd()}…`
    : clean || 'New chat';
};

/** Token counts are estimated (~4 chars per token) until providers report usage. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
