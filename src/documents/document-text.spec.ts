import { speakableText } from '../ai-gateway/speech.js';
import {
  chunkDocument,
  PAGE_BREAK,
  parseAnalysis,
  selectRelevant,
  spread,
} from './document-text.js';

const doc = [
  'Introduction to the platform.\nIt has many parts.',
  'Quotas: free users get 50 chat messages a day.\nPremium gets 500.',
  'Storage keeps media in an S3 bucket.',
].join(PAGE_BREAK);

describe('chunkDocument', () => {
  it('keeps page numbers', () => {
    expect(chunkDocument(doc).map((c) => c.page)).toEqual([1, 2, 3]);
  });

  it('splits long pages into bounded chunks', () => {
    const long = 'word '.repeat(2000);
    const chunks = chunkDocument(long, 500);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.text.length <= 760)).toBe(true);
  });
});

describe('selectRelevant', () => {
  it('returns the matching pages, labelled', () => {
    const excerpt = selectRelevant(chunkDocument(doc), 'What are the quotas?');
    expect(excerpt).toContain('[Page 2]');
    expect(excerpt).not.toContain('[Page 3]');
  });

  it('falls back to the whole document when nothing matches', () => {
    expect(selectRelevant(chunkDocument(doc), 'summarise')).toBe(
      spread(chunkDocument(doc)),
    );
  });
});

describe('parseAnalysis', () => {
  it('reads JSON inside code fences', () => {
    expect(
      parseAnalysis('```json\n{"summary":"S","keyPoints":["a","b"]}\n```'),
    ).toEqual({ summary: 'S', keyPoints: ['a', 'b'] });
  });

  it('falls back to plain text', () => {
    expect(parseAnalysis('Just a summary.')).toEqual({
      summary: 'Just a summary.',
      keyPoints: [],
    });
  });
});

describe('speakableText', () => {
  it('drops markdown and code', () => {
    expect(
      speakableText('## Title\n- **Bold** [link](http://x)\n```js\nx()\n```'),
    ).toBe('Title Bold link (code omitted)');
  });

  it('cuts long text at a sentence end', () => {
    const text = 'One sentence here. '.repeat(200);
    const spoken = speakableText(text, 100);
    expect(spoken.length).toBeLessThanOrEqual(100);
    expect(spoken.endsWith('.')).toBe(true);
  });
});
