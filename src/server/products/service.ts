import { normalizeInput, sha256 } from "@/lib/hash";
import { db } from "@/server/db";

import type { CreateProductInput } from "./dto";

export async function createProduct(input: CreateProductInput) {
  // rawInput is stored exactly as pasted so the UI can show the editor what
  // they submitted; only the hash is computed from the normalized form.
  const inputHash = sha256([normalizeInput(input.rawInput)]);

  return db.product.create({
    data: { title: input.title, rawInput: input.rawInput, inputHash },
    select: { id: true },
  });
}

export async function listProducts() {
  return db.product.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      _count: { select: { generations: true } },
    },
  });
}

export async function getProduct(id: string) {
  return db.product.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      rawInput: true,
      createdAt: true,
      generations: {
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, seoTitle: true, createdAt: true },
      },
    },
  });
}
