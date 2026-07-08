/**
 * fetchCatalog.js
 * READ-ONLY — pulls catalog items, variations, categories, and inventory
 * counts for a specific Square location, then writes:
 *
 *   output/catalog_raw.json  — full raw API response objects
 *   output/menu_raw.json     — cleaned, menu-oriented structure
 *
 * Safe: uses only GET/list/search endpoints. No mutations.
 * Credentials come from .env — token is never printed.
 */

import * as dotenv from "dotenv";
import { SquareClient, SquareEnvironment } from "square";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../output");

// ── Credential checks ──────────────────────────────────────────────────────
if (!process.env.SQUARE_ACCESS_TOKEN) {
  console.error("❌  SQUARE_ACCESS_TOKEN is not set. Copy .env.example → .env and fill it in.");
  process.exit(1);
}
if (!process.env.SQUARE_LOCATION_ID) {
  console.error("❌  SQUARE_LOCATION_ID is not set. Add it to your .env file.");
  process.exit(1);
}

const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const env = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? SquareEnvironment.Sandbox
  : SquareEnvironment.Production;

const client = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: env,
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert Square money object (cents) → readable dollar string */
function formatMoney(money) {
  if (!money) return null;
  return `${(Number(money.amount ?? 0) / 100).toFixed(2)} ${money.currency ?? "USD"}`;
}

/** Pull every page of catalog objects for the given types */
async function listAllCatalogObjects(types) {
  const results = [];
  let cursor = undefined;
  do {
    const res = await client.catalog.list({
      types: types.join(","),
      cursor,
    });
    const objects = res.objects ?? [];
    results.push(...objects);
    cursor = res.cursor;
  } while (cursor);
  return results;
}

/** Pull inventory counts for an array of catalog variation IDs at our location */
async function getInventoryCounts(variationIds) {
  if (variationIds.length === 0) return [];
  // Square batches at 100 IDs max
  const counts = [];
  const BATCH = 100;
  for (let i = 0; i < variationIds.length; i += BATCH) {
    const batch = variationIds.slice(i, i + BATCH);
    const res = await client.inventory.batchGetCounts({
      catalogObjectIds: batch,
      locationIds: [LOCATION_ID],
    });
    counts.push(...(res.counts ?? []));
  }
  return counts;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🔗  Square env: ${process.env.SQUARE_ENVIRONMENT ?? "production"}`);
  console.log(`📍  Location: ${LOCATION_ID}`);

  // 1. Pull all catalog objects we need
  console.log("📦  Fetching catalog objects (ITEM, ITEM_VARIATION, CATEGORY, IMAGE)...");
  const allObjects = await listAllCatalogObjects([
    "ITEM",
    "ITEM_VARIATION",
    "CATEGORY",
    "IMAGE",
  ]);

  console.log(`    Raw objects fetched: ${allObjects.length}`);

  // 2. Separate by type
  const items      = allObjects.filter((o) => o.type === "ITEM");
  const variations = allObjects.filter((o) => o.type === "ITEM_VARIATION");
  const categories = allObjects.filter((o) => o.type === "CATEGORY");
  const images     = allObjects.filter((o) => o.type === "IMAGE");

  console.log(`    Items: ${items.length} | Variations: ${variations.length} | Categories: ${categories.length} | Images: ${images.length}`);

  // 3. Build lookup maps
  const categoryMap = Object.fromEntries(
    categories.map((c) => [c.id, c.categoryData?.name ?? "Unknown"])
  );
  const imageMap = Object.fromEntries(
    images.map((img) => [img.id, img.imageData?.url ?? null])
  );

  // 4. Filter items present at our location
  //    Square items can be present at specific locations via presentAtLocationIds
  //    or absent via absentAtLocationIds. We respect both flags.
  const locationItems = items.filter((item) => {
    const data = item.itemData ?? {};
    // presentAtAllLocations = true means no restriction
    if (item.presentAtAllLocations === true) return true;
    // explicitly present at this location
    if ((item.presentAtLocationIds ?? []).includes(LOCATION_ID)) return true;
    // explicitly absent
    if ((item.absentAtLocationIds ?? []).includes(LOCATION_ID)) return false;
    // default: treat as present if no restriction listed
    return true;
  });

  console.log(`    Items present at location ${LOCATION_ID}: ${locationItems.length}`);

  // 5. Get variation IDs for inventory lookup
  const allVariationIds = locationItems.flatMap((item) =>
    (item.itemData?.variations ?? []).map((v) => v.id)
  );

  console.log(`⚙️   Fetching inventory counts for ${allVariationIds.length} variations...`);
  const inventoryCounts = await getInventoryCounts(allVariationIds);

  // Build inventory map: variationId → { quantity, state }
  const inventoryMap = {};
  for (const count of inventoryCounts) {
    if (count.catalogObjectId) {
      inventoryMap[count.catalogObjectId] = {
        quantity: count.quantity ?? null,
        state: count.state ?? null,      // e.g. "IN_STOCK", "SOLD_OUT", "WASTE" etc.
      };
    }
  }

  // 6. Build clean menu_raw structure
  const menuItems = locationItems.map((item) => {
    const data = item.itemData ?? {};
    const categoryId = data.categoryId ?? null;
    const categoryName = categoryId ? (categoryMap[categoryId] ?? "Uncategorized") : "Uncategorized";

    // Image: item may have imageIds array
    const imageUrl = (data.imageIds ?? []).length > 0
      ? (imageMap[data.imageIds[0]] ?? null)
      : null;

    // Variations
    const variationDetails = (data.variations ?? []).map((v) => {
      const vdata = v.itemVariationData ?? {};
      const inv = inventoryMap[v.id] ?? null;

      // Location-level overrides for this variation
      const locOverride = (vdata.locationOverrides ?? []).find(
        (lo) => lo.locationId === LOCATION_ID
      );

      return {
        variation_id: v.id,
        variation_name: vdata.name ?? null,
        sku: vdata.sku ?? null,
        price: formatMoney(
          locOverride?.priceMoney ?? vdata.priceMoney ?? null
        ),
        price_type: vdata.pricingType ?? null,  // "FIXED_PRICING" | "VARIABLE_PRICING"
        ordinal: vdata.ordinal ?? null,
        // Location presence for this specific variation
        location_present_at_all: v.presentAtAllLocations ?? true,
        location_present_ids: v.presentAtLocationIds ?? [],
        location_absent_ids: v.absentAtLocationIds ?? [],
        // Availability / sold-out fields from location overrides
        sold_out: locOverride?.soldOut ?? false,
        inventory_alert_type: locOverride?.inventoryAlertType ?? null,
        inventory_alert_threshold: locOverride?.inventoryAlertThreshold ?? null,
        // Inventory count (from Inventory API)
        inventory_quantity: inv?.quantity ?? null,
        inventory_state: inv?.state ?? null,
      };
    });

    // Item-level availability flags
    const availabilityPeriodIds = data.availabilityPeriodIds ?? [];

    return {
      item_id: item.id,
      item_name: data.name ?? null,
      category_id: categoryId,
      category_name: categoryName,
      description: data.description ?? null,
      image_url: imageUrl,
      // Location presence flags
      present_at_all_locations: item.presentAtAllLocations ?? true,
      present_at_location_ids: item.presentAtLocationIds ?? [],
      absent_at_location_ids: item.absentAtLocationIds ?? [],
      // Item-level availability
      is_archived: data.isArchived ?? false,
      availability_period_ids: availabilityPeriodIds,
      // Variations
      variations: variationDetails,
      // Convenience: is any variation sold out at this location?
      any_variation_sold_out: variationDetails.some((v) => v.sold_out === true),
      // Convenience: cheapest price across variations
      price_range: (() => {
        const prices = variationDetails
          .map((v) => v.price)
          .filter(Boolean);
        if (prices.length === 0) return null;
        if (prices.length === 1) return prices[0];
        return `${prices[0]} – ${prices[prices.length - 1]}`;
      })(),
    };
  });

  // Sort by category then item name
  menuItems.sort((a, b) => {
    const catCmp = (a.category_name ?? "").localeCompare(b.category_name ?? "");
    if (catCmp !== 0) return catCmp;
    return (a.item_name ?? "").localeCompare(b.item_name ?? "");
  });

  // 7. Save outputs
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // catalog_raw.json — full raw objects (items + variations + categories + images)
  const rawOutput = {
    location_id: LOCATION_ID,
    fetched_at: new Date().toISOString(),
    counts: {
      items: items.length,
      variations: variations.length,
      categories: categories.length,
      images: images.length,
    },
    items,
    variations,
    categories,
    images,
  };
  writeFileSync(
    resolve(OUTPUT_DIR, "catalog_raw.json"),
    JSON.stringify(rawOutput, null, 2)
  );
  console.log(`📄  Saved output/catalog_raw.json`);

  // menu_raw.json — clean, menu-oriented structure
  const menuOutput = {
    location_id: LOCATION_ID,
    fetched_at: new Date().toISOString(),
    item_count: menuItems.length,
    categories: [...new Set(menuItems.map((i) => i.category_name))].sort(),
    items: menuItems,
  };
  writeFileSync(
    resolve(OUTPUT_DIR, "menu_raw.json"),
    JSON.stringify(menuOutput, null, 2)
  );
  console.log(`📄  Saved output/menu_raw.json`);

  // Summary
  const soldOutCount = menuItems.filter((i) => i.any_variation_sold_out).length;
  const archivedCount = menuItems.filter((i) => i.is_archived).length;
  const categoryList = menuOutput.categories;

  console.log(`\n✅  Done.`);
  console.log(`    Items at location:  ${menuItems.length}`);
  console.log(`    Categories:         ${categoryList.length} → ${categoryList.join(", ")}`);
  console.log(`    Any variation sold out: ${soldOutCount}`);
  console.log(`    Archived items:     ${archivedCount}`);
}

main().catch((err) => {
  console.error("❌  Unexpected error:", err.message ?? err);
  process.exit(1);
});
