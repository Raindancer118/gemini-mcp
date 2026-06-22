/**
 * Parse a model response that should be JSON, tolerating Markdown code fences
 * and surrounding prose. Returns the parsed value on success.
 */
export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false } {
  const candidates: string[] = [];

  const trimmed = text.trim();
  candidates.push(trimmed);

  // ```json ... ``` or ``` ... ``` fenced block
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());

  // First {...} or [...] span
  const objSpan = trimmed.match(/[{[][\s\S]*[}\]]/);
  if (objSpan) candidates.push(objSpan[0]);

  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c) };
    } catch {
      /* try next candidate */
    }
  }
  return { ok: false };
}
