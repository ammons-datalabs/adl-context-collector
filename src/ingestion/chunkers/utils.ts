/**
 * Split text into chunks of maxChars with overlapChars overlap.
 * Used as a last resort when paragraph/heading splitting still produces oversized chunks.
 */
export function hardSplit(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars));
    if (start + maxChars >= text.length) break; // chunk reached end of text
    const nextStart = start + maxChars - overlapChars;
    if (nextStart <= start) break; // safety: avoid infinite loop
    start = nextStart;
  }
  return chunks;
}
