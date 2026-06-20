import { db } from "../db";
import type { InventoryBatch, InventoryConcept, InventorySnapshot, Product } from "../../types/domain";
import { createId } from "../../utils/id";
import { isoNow } from "../../utils/date";
import { settingsRepository } from "./settingsRepository";

export type ConceptInput = Omit<InventoryConcept, "id" | "createdAt" | "updatedAt">;
export type ConceptPatch = Partial<ConceptInput>;
export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;
export type ProductPatch = Partial<ProductInput>;
export type BatchInput = Omit<InventoryBatch, "id" | "createdAt" | "updatedAt">;

export const inventoryRepository = {
  async snapshot(): Promise<InventorySnapshot> {
    const [concepts, products, batches, settings] = await Promise.all([
      db.concepts.orderBy("name").toArray(),
      db.products.orderBy("brand").toArray(),
      db.batches.orderBy("expirationDate").toArray(),
      settingsRepository.get()
    ]);

    return { concepts, products, batches, settings };
  },

  async addConcept(input: ConceptInput) {
    if (!Number.isFinite(input.reorderPoint) || input.reorderPoint < 0) {
      throw new Error("Reorder point must be 0 or greater.");
    }

    if (input.reorderAmount !== undefined && (!Number.isFinite(input.reorderAmount) || input.reorderAmount < 0)) {
      throw new Error("Reorder amount must be 0 or greater.");
    }

    const now = isoNow();
    const concept: InventoryConcept = { ...input, id: createId(), isActive: true, createdAt: now, updatedAt: now };
    await db.concepts.add(concept);
    return concept;
  },

  async updateConcept(id: string, patch: ConceptPatch) {
    const concept = await db.concepts.get(id);
    if (!concept) {
      throw new Error("Concept was not found.");
    }

    if (patch.reorderPoint !== undefined && (!Number.isFinite(patch.reorderPoint) || patch.reorderPoint < 0)) {
      throw new Error("Reorder point must be 0 or greater.");
    }

    if (patch.reorderAmount !== undefined && (!Number.isFinite(patch.reorderAmount) || patch.reorderAmount < 0)) {
      throw new Error("Reorder amount must be 0 or greater.");
    }

    const updatedConcept: InventoryConcept = { ...concept, ...patch, updatedAt: isoNow() };
    await db.concepts.put(updatedConcept);
    return updatedConcept;
  },

  async addProduct(input: ProductInput) {
    if (!Number.isFinite(input.packageQuantity) || input.packageQuantity <= 0) {
      throw new Error("Package quantity must be greater than 0.");
    }

    const now = isoNow();
    const product: Product = { ...input, id: createId(), upc: normalizeProductCode(input.upc), isActive: true, createdAt: now, updatedAt: now };
    await db.products.add(product);
    return product;
  },

  async updateProduct(id: string, patch: ProductPatch) {
    const product = await db.products.get(id);
    if (!product) {
      throw new Error("Product was not found.");
    }

    if (patch.packageQuantity !== undefined && (!Number.isFinite(patch.packageQuantity) || patch.packageQuantity <= 0)) {
      throw new Error("Package quantity must be greater than 0.");
    }

    const updatedProduct: Product = {
      ...product,
      ...patch,
      upc: patch.upc ? normalizeProductCode(patch.upc) : product.upc,
      updatedAt: isoNow()
    };
    await db.products.put(updatedProduct);
    return updatedProduct;
  },

  async removeProductFromSelection(id: string) {
    const product = await db.products.get(id);
    if (!product) {
      throw new Error("Product was not found.");
    }

    await db.products.update(id, { isActive: false, updatedAt: isoNow() });
  },

  async deleteDeprecatedProducts(ids: string[]) {
    return db.transaction("rw", db.products, db.batches, async () => {
      const uniqueIds = [...new Set(ids)];
      const deletedProducts: Product[] = [];

      for (const id of uniqueIds) {
        const product = await db.products.get(id);
        if (!product || product.isActive !== false) {
          continue;
        }

        const batchCount = await db.batches.where("productId").equals(id).count();
        if (batchCount > 0) {
          continue;
        }

        await db.products.delete(id);
        deletedProducts.push(product);
      }

      return deletedProducts;
    });
  },

  async addBatch(input: BatchInput) {
    if (!Number.isFinite(input.containerCount) || input.containerCount < 1) {
      throw new Error("Batch container count must be at least 1.");
    }

    return db.transaction("rw", db.batches, async () => {
      const now = isoNow();
      const matchingBatch = await db.batches
        .where("productId")
        .equals(input.productId)
        .filter((batch) => batch.expirationDate === input.expirationDate)
        .first();

      if (matchingBatch) {
        const batch: InventoryBatch = {
          ...matchingBatch,
          containerCount: matchingBatch.containerCount + input.containerCount,
          updatedAt: now
        };
        await db.batches.put(batch);
        return batch;
      }

      const batch: InventoryBatch = { ...input, id: createId(), createdAt: now, updatedAt: now };
      await db.batches.add(batch);
      return batch;
    });
  },

  async updateBatchCount(id: string, containerCount: number) {
    if (!Number.isFinite(containerCount)) {
      throw new Error("Enter a valid container count.");
    }

    if (containerCount <= 0) {
      await db.batches.delete(id);
      return;
    }

    await db.batches.update(id, { containerCount, updatedAt: isoNow() });
  },

  async removeOneContainer(id: string) {
    const batch = await db.batches.get(id);
    if (!batch) {
      throw new Error("Batch was not found.");
    }

    if (batch.containerCount <= 1) {
      await db.batches.delete(id);
      return 0;
    }

    const containerCount = batch.containerCount - 1;
    await db.batches.update(id, { containerCount, updatedAt: isoNow() });
    return containerCount;
  },

  async findProductByUpc(upc: string) {
    return db.products.where("upc").equals(normalizeProductCode(upc)).first();
  }
};

export const normalizeProductCode = (value: string) => value.replace(/[^a-z0-9]/gi, "").toUpperCase().trim();

export const normalizeUpc = normalizeProductCode;
