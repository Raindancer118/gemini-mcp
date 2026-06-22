import { buildTranscribePrompt } from '../register-transcribe.js';
import { buildExtractionPrompt } from '../register-extract.js';

describe('buildTranscribePrompt', () => {
  it('asks for verbatim transcript with no commentary', () => {
    const p = buildTranscribePrompt({});
    expect(p).toMatch(/verbatim/i);
    expect(p).toMatch(/no summary/i);
  });

  it('adds diarization, timestamps and language when requested', () => {
    const p = buildTranscribePrompt({ language: 'German', timestamps: true, diarization: true });
    expect(p).toMatch(/German/);
    expect(p).toMatch(/Speaker 1/);
    expect(p).toMatch(/\[mm:ss\]/);
  });

  it('omits optional sections by default', () => {
    const p = buildTranscribePrompt({});
    expect(p).not.toMatch(/Speaker 1/);
    expect(p).not.toMatch(/\[mm:ss\]/);
  });
});

describe('buildExtractionPrompt', () => {
  it('demands JSON-only output and includes the instructions', () => {
    const p = buildExtractionPrompt('invoice number and total', false);
    expect(p).toMatch(/ONLY JSON/i);
    expect(p).toMatch(/invoice number and total/);
  });

  it('mentions schema conformance only when a schema is provided', () => {
    expect(buildExtractionPrompt('x', true)).toMatch(/response schema/i);
    expect(buildExtractionPrompt('x', false)).not.toMatch(/response schema/i);
  });
});
