"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { parseFrame, splitFrames } from "@/lib/sse";

type Status = "idle" | "streaming" | "done" | "cancelled" | "failed";

export function DescriptionStream({
  generationId,
  initialDescription,
  initialPartial,
}: {
  generationId: string;
  initialDescription: string | null;
  initialPartial: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialDescription ?? "");
  const [status, setStatus] = useState<Status>(
    initialDescription && !initialPartial ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setText("");
    setError(null);
    setStatus("streaming");

    try {
      const response = await fetch(`/api/generations/${generationId}/description`, {
        method: "POST",
        signal: controller.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        // stream: true keeps a multi-byte character that was split across two
        // chunks from being decoded as two replacement characters.
        buffer += decoder.decode(value, { stream: true });

        const { frames, rest } = splitFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          const event = parseFrame(frame);
          if (!event) continue;

          if (event.name === "delta") {
            const { text: delta } = event.data as { text: string };
            setText((current) => current + delta);
          } else if (event.name === "done") {
            setStatus("done");
          } else if (event.name === "failed") {
            const { code, message } = event.data as { code: string; message: string };
            setStatus("failed");
            setError(FAILURE_MESSAGES[code] ?? message);
          }
        }
      }

      // The server closed without a terminal event: the connection broke
      // mid-stream rather than the generation finishing.
      setStatus((current) => (current === "streaming" ? "failed" : current));
      setError((current) =>
        current ?? "The connection closed before the description was finished.",
      );
    } catch (cause) {
      // An abort is the user pressing Stop, not a failure. The text already on
      // screen stays — the server has it saved as partial.
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setStatus("cancelled");
      } else {
        setStatus("failed");
        setError("Lost the connection to the server.");
      }
    } finally {
      abortRef.current = null;
      router.refresh();
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Description</h2>
        {status === "streaming" ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700"
          >
            {text ? "Rewrite" : "Write description"}
          </button>
        )}
        <StatusBadge status={status} />
      </div>

      {text ? (
        <p className="rounded-md border border-zinc-200 bg-white p-4 text-sm leading-relaxed whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900">
          {text}
          {status === "streaming" ? <span className="animate-pulse">▍</span> : null}
        </p>
      ) : null}

      {status === "cancelled" ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Stopped. The partial text above is saved and marked incomplete.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </section>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "idle") return null;
  return <span className="text-xs text-zinc-500">{status}</span>;
}

const FAILURE_MESSAGES: Record<string, string> = {
  refusal: "The model declined to write a description for these specs.",
  truncated: "The description hit the length ceiling and was cut off.",
  rate_limited: "Rate limited by the provider. Try again in a moment.",
  overloaded: "The provider is overloaded. Try again in a moment.",
  timeout: "The provider took too long to respond.",
  network_error: "Could not reach the model provider.",
  not_ready: "Generate the title and benefits first.",
  not_found: "This generation no longer exists.",
};
