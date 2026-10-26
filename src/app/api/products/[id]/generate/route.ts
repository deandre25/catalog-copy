import { generateCopyForProduct } from "@/server/generation/service";

/**
 * Must stay above the retry policy's total budget (45s) and below the hosting
 * plan's function limit, or the platform kills the handler mid-retry and the
 * browser sees a dropped connection instead of the real error.
 */
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/products/[id]/generate">,
) {
  const { id } = await params;
  // A closed tab aborts this signal, which cancels the in-flight model call
  // instead of paying for tokens nobody will read.
  const outcome = await generateCopyForProduct(id, { signal: request.signal });

  if (outcome.ok) {
    return Response.json({ generationId: outcome.generationId }, { status: 201 });
  }

  if (outcome.reason === "product_not_found") {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }

  const headers = new Headers();
  if (outcome.retryAfterSeconds !== null) {
    headers.set("retry-after", String(outcome.retryAfterSeconds));
  }

  return Response.json(
    {
      error: outcome.code,
      retryable: outcome.retryable,
      generationId: outcome.generationId,
    },
    { status: STATUS_BY_CODE[outcome.code] ?? 502, headers },
  );
}

/**
 * The failure is reported with the status that describes who has to act: 422
 * when the request will never succeed as written, 429/503 when the caller
 * should come back later, 502 when the upstream provider is at fault.
 */
const STATUS_BY_CODE: Record<string, number> = {
  refusal: 422,
  truncated: 422,
  invalid_output: 422,
  rate_limited: 429,
  overloaded: 503,
  timeout: 504,
  network_error: 502,
  api_error: 502,
  aborted: 499,
};
