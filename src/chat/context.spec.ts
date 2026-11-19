import { buildContext, SYSTEM_PROMPT, titleFrom } from './context.js';

const msg = (
  id: string,
  role: 'user' | 'assistant',
  content: string,
  modelId?: string,
) => ({
  id,
  role,
  content,
  modelId,
});

describe('buildContext', () => {
  it('keeps replies from other models as plain assistant turns', () => {
    const turns = buildContext([
      msg('1', 'user', 'hi'),
      msg('2', 'assistant', 'hello from Gemini', 'gemini-flash'),
      msg('3', 'user', 'now as Qwen'),
    ]);
    expect(turns).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello from Gemini' },
      { role: 'user', content: 'now as Qwen' },
    ]);
  });

  it('drops the oldest turns first but always keeps the latest message', () => {
    const turns = buildContext(
      [msg('1', 'user', 'a'.repeat(50)), msg('2', 'user', 'b'.repeat(80))],
      60,
    );
    expect(turns.map((t) => t.content[0])).toEqual([SYSTEM_PROMPT[0], 'b']);
  });

  it('mentions attachments by name', () => {
    const turns = buildContext([
      {
        ...msg('1', 'user', 'summarize'),
        attachments: [{ name: 'report.pdf' }],
      },
    ]);
    expect(turns[1].content).toContain('[Attached files: report.pdf]');
  });
});

describe('titleFrom', () => {
  it('collapses whitespace and truncates long prompts', () => {
    expect(titleFrom('  hello \n world ')).toBe('hello world');
    expect(titleFrom('x'.repeat(100))).toHaveLength(60);
  });
});
