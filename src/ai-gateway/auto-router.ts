import type { Plan } from '@prisma/client';

export type Intent = 'coding' | 'reasoning' | 'general';

// Initial routing table. It is code for now; Phase 7 moves it to the admin panel.
const PREFERENCES: Record<Intent, string[]> = {
  coding: ['groq-qwen3-32b', 'mistral-small', 'gemini-flash'],
  reasoning: ['groq-gpt-oss-120b', 'gemini-pro', 'gemini-flash'],
  general: ['gemini-flash', 'groq-gpt-oss-120b', 'openrouter-llama-free'],
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
}

/** Picks the preferred model for the prompt among the ones this user can use right now. */
export function pickAutoModel(
  prompt: string,
  candidates: RoutableModel[],
  plan: Plan,
) {
  const allowed = candidates.filter(
    (m) => plan === 'premium' || m.tier === 'free',
  );
  const allowedIds = new Set(allowed.map((m) => m.id));
  return (
    PREFERENCES[detectIntent(prompt)].find((id) => allowedIds.has(id)) ??
    allowed[0]?.id
  );
}
