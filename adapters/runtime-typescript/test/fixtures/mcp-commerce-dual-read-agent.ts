const ATTRIBUTION_NOTE =
  "Shopify Admin commerce data and GA4 analytics metrics are not directly reconcilable without documented attribution, timezone, currency, and measurement definitions.";

export async function run(context: {
  readonly input: unknown;
  readonly tools: {
    readonly invoke: (binding: string, input: unknown) => Promise<unknown>;
  };
}): Promise<unknown> {
  const record =
    context.input !== null && typeof context.input === "object"
      ? (context.input as { propertyId?: unknown })
      : {};
  const propertyId =
    typeof record.propertyId === "string" && record.propertyId.trim().length > 0
      ? record.propertyId.trim()
      : undefined;

  const shop = await context.tools.invoke("shopifyShopGet", {});
  const property = await context.tools.invoke(
    "ga4PropertyGet",
    propertyId !== undefined ? { propertyId } : {},
  );

  return {
    shop,
    property,
    attributionNote: ATTRIBUTION_NOTE,
  };
}
