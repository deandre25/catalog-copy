import { z } from "zod";

import { createProductSchema } from "@/server/products/dto";
import { createProduct } from "@/server/products/service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = createProductSchema.safeParse(body);

  if (!parsed.success) {
    // formErrors carries the whole-body failures (malformed JSON, wrong type),
    // which never land in fieldErrors and would otherwise be an empty response.
    const { fieldErrors, formErrors } = z.flattenError(parsed.error);
    return Response.json(
      { error: "validation_error", fieldErrors, formErrors },
      { status: 400 },
    );
  }

  const product = await createProduct(parsed.data);

  return Response.json(product, { status: 201 });
}
