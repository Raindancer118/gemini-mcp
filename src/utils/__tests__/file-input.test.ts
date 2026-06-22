import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { classifyFile } from '../file-input.js';

describe('classifyFile', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-input-test-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads a known text/code file as text', async () => {
    const p = join(dir, 'note.md');
    await writeFile(p, '# Hello\ntext body');
    const c = await classifyFile(p);
    expect(c.mode).toBe('text');
    if (c.mode === 'text') {
      expect(c.text).toContain('Hello');
      expect(c.mimeType).toBe('text/markdown');
    }
  });

  it('classifies a PDF as inline with the right mime type', async () => {
    const p = join(dir, 'doc.pdf');
    await writeFile(p, Buffer.from('%PDF-1.4 minimal', 'utf8'));
    const c = await classifyFile(p);
    expect(c.mode).toBe('inline');
    if (c.mode === 'inline') {
      expect(c.mimeType).toBe('application/pdf');
      expect(c.data).toBe(Buffer.from('%PDF-1.4 minimal', 'utf8').toString('base64'));
    }
  });

  it('classifies an image as inline', async () => {
    const p = join(dir, 'pic.png');
    await writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const c = await classifyFile(p);
    expect(c.mode).toBe('inline');
    if (c.mode === 'inline') expect(c.mimeType).toBe('image/png');
  });

  it('treats an unknown-extension textual file as text', async () => {
    const p = join(dir, 'weird.xyz');
    await writeFile(p, 'just some plain text');
    const c = await classifyFile(p);
    expect(c.mode).toBe('text');
    if (c.mode === 'text') expect(c.text).toBe('just some plain text');
  });

  it('rejects an unknown-extension binary file', async () => {
    const p = join(dir, 'blob.xyz');
    await writeFile(p, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
    await expect(classifyFile(p)).rejects.toThrow(/Unsupported file type/i);
  });
});
