import { parseJsonLoose } from '../json-extract.js';

describe('parseJsonLoose', () => {
  it('parses clean JSON', () => {
    const r = parseJsonLoose('{"a":1,"b":[2,3]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, b: [2, 3] });
  });

  it('parses JSON inside a ```json fence', () => {
    const r = parseJsonLoose('```json\n{"x": true}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: true });
  });

  it('parses a JSON object embedded in prose', () => {
    const r = parseJsonLoose('Here you go: {"n": 42} hope that helps');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ n: 42 });
  });

  it('parses a top-level array', () => {
    const r = parseJsonLoose('[1, 2, 3]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 2, 3]);
  });

  it('fails on non-JSON', () => {
    expect(parseJsonLoose('not json at all').ok).toBe(false);
  });
});
