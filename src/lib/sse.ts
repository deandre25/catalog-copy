export type SseFrame = { name: string; data: unknown };

/**
 * Splits a buffer on frame boundaries and returns the trailing fragment.
 *
 * A network chunk has nothing to do with a frame: one chunk can hold three
 * frames, or half of one. Treating each chunk as a frame silently drops text
 * whenever a boundary falls mid-frame, which is the usual bug in hand-written
 * SSE clients.
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  return { frames: parts.slice(0, -1), rest: parts.at(-1) ?? "" };
}

export function parseFrame(frame: string): SseFrame | null {
  let name = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    // Per the SSE format a frame may carry several data lines, which are
    // rejoined with newlines before parsing.
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    return { name, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
