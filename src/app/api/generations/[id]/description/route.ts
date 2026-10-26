import { writeDescription } from "@/server/generation/description-service";

// 60s rather than higher: it is above the 45s retry budget the stream runs on,
// so the handler outlives its own worst case, and it is inside the ceiling the
// cheapest Vercel plan allows — a declared duration above the plan limit fails
// the deployment rather than degrading.
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/generations/[id]/description">,
) {
  const { id } = await params;
  // Set by the Rewrite button to bypass the cache for this one request.
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // SSE frames are separated by a blank line, so a payload may not contain
      // a raw newline. JSON.stringify escapes them, which matters here because
      // the description has paragraph breaks in it.
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for await (const progress of writeDescription(id, { signal: request.signal, fresh })) {
          if (progress.type === "delta") {
            send("delta", { text: progress.text });
          } else if (progress.type === "done") {
            send("done", {});
          } else {
            send("failed", { code: progress.code, message: progress.message });
          }
        }
      } catch (error) {
        // After the client is gone, enqueue throws. That is the expected end of
        // a cancelled stream, not something to report.
        if (!request.signal.aborted) {
          send("failed", {
            code: "unknown",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the disconnect.
        }
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform stops a proxy from gzipping the response, which would
      // buffer it; x-accel-buffering is the nginx-specific equivalent. Without
      // both, the stream can arrive as one block at the end and look broken.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
