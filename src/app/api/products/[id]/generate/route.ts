import { generateCopyForProduct } from "@/server/generation/service";

export async function POST(_request: Request, { params }: RouteContext<"/api/products/[id]/generate">) {
  const { id } = await params;
  const outcome = await generateCopyForProduct(id);

  if (outcome.ok) {
    return Response.json({ generationId: outcome.generationId }, { status: 201 });
  }

  if (outcome.reason === "product_not_found") {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }

  // 502: the request was valid, the upstream model call is what failed. The
  // failure is already persisted on the generation row, so the id is returned
  // and the UI can show what went wrong.
  return Response.json(
    { error: outcome.code, generationId: outcome.generationId },
    { status: 502 },
  );
}
