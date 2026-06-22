import { buildSummaryInstruction } from '../register-summary.js';
import { buildOcrPrompt } from '../register-ocr.js';

describe('buildSummaryInstruction', () => {
  it('varies the instruction by length', () => {
    expect(buildSummaryInstruction('brief')).toMatch(/2-3 sentences/);
    expect(buildSummaryInstruction('bullets')).toMatch(/bullet list/i);
    expect(buildSummaryInstruction('detailed')).toMatch(/few paragraphs/);
  });

  it('includes focus and language when provided', () => {
    const out = buildSummaryInstruction('standard', 'risks', 'German');
    expect(out).toMatch(/Focus especially on: risks/);
    expect(out).toMatch(/Write the summary in German/);
  });

  it('omits focus/language when not provided', () => {
    const out = buildSummaryInstruction('standard');
    expect(out).not.toMatch(/Focus especially/);
    expect(out).not.toMatch(/Write the summary in/);
  });
});

describe('buildOcrPrompt', () => {
  it('asks for verbatim extraction without commentary', () => {
    const p = buildOcrPrompt();
    expect(p).toMatch(/verbatim/i);
    expect(p).toMatch(/do not summarize/i);
  });

  it('adds a language hint when given', () => {
    expect(buildOcrPrompt('German')).toMatch(/German/);
  });
});
