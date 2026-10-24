// An independently authored, memory-only ESM extension. No host internals.
/** @type {import('../../../modules/sdk').ExtensionMain} */
export default {
  activate(ctx) {
    /** @type {{ price(sku: string): number }} */
    const pricing = ctx.use("author.unit-price");
    let total = 0;
    let accepted = 0;
    ctx.provide("author.batch-total", 1, {
      snapshot: () => ({ total, accepted }),
    });
    ctx.on("author.batch-submit", (data) => {
      const batch =
        /** @type {Partial<{ sku: string, quantity: number }> | null | undefined} */ (
          data
        );
      if (
        !batch ||
        typeof batch.sku !== "string" ||
        typeof batch.quantity !== "number" ||
        !Number.isSafeInteger(batch.quantity) ||
        batch.quantity <= 0
      )
        return;
      const unitPrice = pricing.price(batch.sku);
      if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) return;
      const subtotal = unitPrice * batch.quantity;
      if (!Number.isSafeInteger(total + subtotal)) return;
      total += subtotal;
      accepted += 1;
      ctx.emit("author.batch-receipt", {
        sku: batch.sku,
        subtotal,
        total,
        accepted,
      });
    });
  },
};
