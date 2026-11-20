import { extractText, getDocumentProxy } from 'unpdf';

/** Pages are joined with a form feed so page numbers survive storage as one string. */
export const PAGE_BREAK = '\f';
const MAX_STORED_CHARS = 300_000;

export interface ExtractedText {
  text: string;
  pages: number;
}

export async function extractDocumentText(
  data: Buffer,
  kind: 'pdf' | 'text',
): Promise<ExtractedText> {
  if (kind === 'text') {
    return { text: data.toString('utf8').slice(0, MAX_STORED_CHARS), pages: 1 };
  }
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return {
    text: text
      .map((page) => page.replace(/[ \t]+/g, ' ').trim())
      .join(PAGE_BREAK)
      .slice(0, MAX_STORED_CHARS),
    pages: totalPages,
  };
}

export interface Chunk {
  page: number;
  text: string;
}

/** Splits each page into paragraph-aligned chunks of about `size` characters. */
export function chunkDocument(text: string, size = 1500): Chunk[] {
  const chunks: Chunk[] = [];
  text.split(PAGE_BREAK).forEach((pageText, index) => {
    let current = '';
    for (const paragraph of pageText.split(/\n\s*\n|\n/)) {
      if (current && current.length + paragraph.length > size) {
        chunks.push({ page: index + 1, text: current.trim() });
        current = '';
      }
      current += `${paragraph}\n`;
      while (current.length > size * 1.5) {
        chunks.push({ page: index + 1, text: current.slice(0, size).trim() });
        current = current.slice(size);
      }
    }
    if (current.trim()) chunks.push({ page: index + 1, text: current.trim() });
  });
  return chunks;
}

const STOP_WORDS = new Set(
  'the and for are was were what when where which who why how does did this that with from have has had you your about into than then them they their there these those will would could should can not but its our out all any per via'.split(
    ' ',
  ),
);

const terms = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

const label = (chunk: Chunk) => `[Page ${chunk.page}]\n${chunk.text}`;

/**
 * Keyword retrieval: the chunks sharing the most terms with the question, up to the
 * budget, returned in document order so the excerpts read naturally. Without any
 * overlap (e.g. "summarise this") it falls back to an even spread of the document.
 */
export function selectRelevant(
  chunks: Chunk[],
  question: string,
  budget = 12_000,
): string {
  const wanted = new Set(terms(question));
  const scored = chunks
    .map((chunk, index) => ({
      index,
      score: terms(chunk.text).filter((t) => wanted.has(t)).length,
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (!scored.length) return spread(chunks, budget);

  const picked: number[] = [];
  let used = 0;
  for (const { index } of scored) {
    const length = chunks[index].text.length;
    if (used + length > budget) continue;
    picked.push(index);
    used += length;
  }
  return picked
    .sort((a, b) => a - b)
    .map((i) => label(chunks[i]))
    .join('\n\n');
}

/** Evenly spaced chunks covering the whole document within the budget. */
export function spread(chunks: Chunk[], budget = 24_000): string {
  const total = chunks.reduce((sum, c) => sum + c.text.length, 0);
  const step = Math.max(1, Math.ceil(total / budget));
  return chunks
    .filter((_, i) => i % step === 0)
    .map(label)
    .join('\n\n')
    .slice(0, budget);
}

/** Reads `{ summary, keyPoints }` from a model reply, tolerating code fences. */
export function parseAnalysis(reply: string): {
  summary: string;
  keyPoints: string[];
} {
  const json = reply.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as {
        summary?: unknown;
        keyPoints?: unknown;
      };
      if (typeof parsed.summary === 'string') {
        return {
          summary: parsed.summary.trim(),
          keyPoints: Array.isArray(parsed.keyPoints)
            ? parsed.keyPoints.filter((p) => typeof p === 'string').slice(0, 8)
            : [],
        };
      }
    } catch {
      // Not JSON after all; use the reply as plain text below.
    }
  }
  return { summary: reply.trim(), keyPoints: [] };
}
