import type { Plan } from '@prisma/client';

/** `fast` is never detected from a prompt; callers pass it for quick utility tasks. */
export type Intent = 'coding' | 'reasoning' | 'general' | 'fast';

// Initial routing table. It is code for now; Phase 7 moves it to the admin panel.
const PREFERENCES: Record<Intent, string[]> = {
  coding: ['groq-qwen3-32b', 'mistral-small', 'gemini-flash'],
  reasoning: ['groq-gpt-oss-120b', 'gemini-pro', 'gemini-flash'],
  general: ['gemini-flash', 'groq-gpt-oss-120b', 'openrouter-llama-free'],
  fast: [
    'groq-gpt-oss-120b',
    'groq-qwen3-32b',
    'mistral-small',
    'gemini-flash',
  ],
};

export function detectIntent(prompt: string): Intent {
  const text = prompt.toLowerCase();
  if (
    /\b(code|coding|bug|function|class|typescript|javascript|python|java|sql|regex|api|error|stack trace)\b/.test(
      text,
    ) ||
    text.includes('```')
  ) {
    return 'coding';
  }
  if (
    /\b(prove|proof|reason|step by step|math|calculate|why|analy[sz]e|compare)\b/.test(
      text,
    )
  ) {
    return 'reasoning';
  }
  return 'general';
}

export interface RoutableModel {
  id: string;
  tier: Plan;
  capabilities?: string[];
}

/**
 * Orders the models this user can use right now for the prompt: preferred models for
 * the intent first, then every other allowed model. The tail is the fallback chain used
 * when a provider is overloaded or down. Pay-per-use models are never picked here, so
 * they only cost money when a user chooses one explicitly.
 */
export function rankAutoModels(
  prompt: string,
  candidates: RoutableModel[],
  plan: Plan,
  intent: Intent = detectIntent(prompt),
): string[] {
  const allowed = candidates
    .filter((m) => plan === 'premium' || m.tier === 'free')
    .filter((m) => !m.capabilities?.includes('paid'))
    .map((m) => m.id);
  const preferred = PREFERENCES[intent].filter((id) => allowed.includes(id));
  return [...preferred, ...allowed.filter((id) => !preferred.includes(id))];
}

/** Picks the preferred model for the prompt among the ones this user can use right now. */
export function pickAutoModel(
  prompt: string,
  candidates: RoutableModel[],
  plan: Plan,
) {
  return rankAutoModels(prompt, candidates, plan)[0];
}
