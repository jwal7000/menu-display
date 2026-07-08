/**
 * buildMenu.js
 * READ-ONLY transform — reads output/menu_raw.json + menu_config.json
 * and produces a clean customer-facing output/menu.json.
 *
 * No Square API calls. No mutations. Pure data shaping.
 *
 * All display rules (sections, hidden items, name overrides, price overrides,
 * sort order, sold-out behavior) come from menu_config.json. Edit that file
 * to change what appears on the menu board — never touch Square directly.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR   = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT_DIR, "output");

const INPUT_FILE  = resolve(OUTPUT_DIR, "menu_raw.json");
const CONFIG_FILE = resolve(ROOT_DIR, "menu_config.json");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "menu.json");

// ── Load files ─────────────────────────────────────────────────────────────

function loadJSON(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`❌  Could not read ${label} at ${path}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip _comment and _example meta-keys from config objects (used for inline docs). */
function stripMeta(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !k.startsWith("_"))
  );
}

/** Parse a price string like "4.50 USD" or "$4.50" → cents (number). */
function parsePriceCents(priceStr) {
  if (!priceStr) return null;
  const match = String(priceStr).match(/([\d.]+)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : null;
}

/** Format cents → "$4.50" */
function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Deduplicate variations by name.
 * When two variations share a name (e.g. both called "Regular"),
 * prefer the one with a SKU; otherwise keep the highest ordinal.
 */
function deduplicateVariations(variations) {
  const byName = new Map();
  for (const v of variations) {
    const key = (v.variation_name ?? "").toLowerCase().trim();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(v);
  }
  const result = [];
  for (const group of byName.values()) {
    if (group.length === 1) { result.push(group[0]); continue; }
    const withSku = group.filter((v) => v.sku);
    const chosen  = withSku.length > 0
      ? withSku[withSku.length - 1]
      : group.sort((a, b) => (b.ordinal ?? 0) - (a.ordinal ?? 0))[0];
    result.push(chosen);
  }
  return result.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
}

// ── Main ───────────────────────────────────────────────────────────────────

function buildMenu() {
  const raw    = loadJSON(INPUT_FILE,  "menu_raw.json");
  const config = loadJSON(CONFIG_FILE, "menu_config.json");

  // ── Validate config ──────────────────────────────────────────────────────

  if (!Array.isArray(config.sections) || config.sections.length === 0) {
    console.error("❌  menu_config.json must have a non-empty 'sections' array.");
    process.exit(1);
  }

  const locationId          = raw.location_id ?? "unknown";
  const fetchedAt           = raw.fetched_at  ?? new Date().toISOString();
  const allItems            = raw.items        ?? [];
  const unavailableBehavior = config.unavailable_items?.behavior ?? "show_as_sold_out";
  const hiddenKeywords      = (config.hidden_item_keywords ?? []).map((k) => k.toLowerCase());
  const hiddenVariationIds  = new Set(config.hidden_variation_ids ?? []);
  const nameOverrides       = stripMeta(config.display_name_overrides ?? {});
  const priceOverrides      = stripMeta(config.price_overrides        ?? {});
  const sortOverrides       = stripMeta(config.item_sort_overrides    ?? {});

  // Build a map: Square category name → section config
  const categoryToSection = new Map();
  for (const section of config.sections) {
    for (const sqCat of section.square_categories ?? []) {
      categoryToSection.set(sqCat, section);
    }
  }

  console.log(`📍  Location:  ${locationId}`);
  console.log(`⚙️   Config:    ${config.location_display_name ?? locationId}`);
  console.log(`📦  Input items: ${allItems.length}`);
  console.log(`📋  Sections:    ${config.sections.length}`);

  const stats = {
    excluded_no_section:  0,
    excluded_keyword:     0,
    excluded_no_price:    0,
    excluded_archived:    0,
    hidden_sold_out:      0,
    included:             0,
  };

  // Collect items by section name
  const sectionMap = new Map(config.sections.map((s) => [s.name, []]));

  for (const item of allItems) {
    // 1. Skip archived
    if (item.is_archived) {
      stats.excluded_archived++;
      continue;
    }

    // 2. Map Square category → section. Skip if not in any section.
    const section = categoryToSection.get(item.category_name);
    if (!section) {
      stats.excluded_no_section++;
      continue;
    }

    // 3. Hidden keyword check against item name
    const nameLower = (item.item_name ?? "").toLowerCase();
    if (hiddenKeywords.some((kw) => nameLower.includes(kw))) {
      stats.excluded_keyword++;
      continue;
    }

    // 4. Process variations
    const rawVariations = deduplicateVariations(item.variations ?? []);

    const processedVariations = rawVariations
      .filter((v) => !hiddenVariationIds.has(v.variation_id))
      .map((v) => {
        // Resolve price: config override → Square price
        const priceStr = priceOverrides[v.variation_id] ?? v.price;
        const cents    = parsePriceCents(priceStr);
        return { ...v, _resolved_cents: cents };
      })
      .filter((v) => v._resolved_cents !== null && v._resolved_cents > 0);

    // 5. Skip item if no valid-priced variation remains
    if (processedVariations.length === 0) {
      stats.excluded_no_price++;
      continue;
    }

    // 6. Sold-out logic
    const isSoldOut = item.any_variation_sold_out ?? false;
    if (isSoldOut && unavailableBehavior === "hide") {
      stats.hidden_sold_out++;
      continue;
    }

    // 7. Display name: config override → cleaned Square name (strip location suffixes)
    let displayName = nameOverrides[item.item_id] ?? item.item_name ?? "";
    // Strip common location-specific suffixes baked into Square item names
    const locationSuffixes = [
      " - 12th South", " - East Nashville", " - The Factory",
      " - Westside", " - Avalon", " - The Gulch",
      " - Ponce City Market", " - L&L Market",
      " - The Fountains", " - 5th & Broad",
    ];
    for (const suffix of locationSuffixes) {
      if (displayName.endsWith(suffix)) {
        displayName = displayName.slice(0, -suffix.length).trim();
        break;
      }
    }

    // 8. Determine whether to suppress variation_name
    //    Suppress when single variation named "Regular" or blank
    const suppressVariationName =
      processedVariations.length === 1 &&
      ["regular", ""].includes(
        (processedVariations[0].variation_name ?? "").toLowerCase().trim()
      );

    // 9. Build clean variation objects
    const cleanVariations = processedVariations.map((v) => {
      const displayPrice = formatPrice(v._resolved_cents);
      const base = {
        variation_id: v.variation_id,
        price:        displayPrice,
        sold_out:     v.sold_out ?? false,
      };
      if (!suppressVariationName && v.variation_name) {
        base.variation_name = v.variation_name;
      }
      return base;
    });

    // 10. Derive item-level display price
    const allCents  = processedVariations.map((v) => v._resolved_cents);
    const minCents  = Math.min(...allCents);
    const maxCents  = Math.max(...allCents);
    const displayPrice = minCents === maxCents
      ? formatPrice(minCents)
      : `${formatPrice(minCents)} – ${formatPrice(maxCents)}`;

    // 11. Assemble clean item
    const cleanItem = {
      item_id:   item.item_id,
      name:      displayName,
      price:     displayPrice,
      sold_out:  isSoldOut,
      ...(item.description ? { description: item.description } : {}),
      ...(item.image_url   ? { image_url:   item.image_url   } : {}),
      ...(cleanVariations.length > 1 ? { variations: cleanVariations } : {}),
      // Internal sort key — stripped before final output
      _sort_override: sortOverrides[item.item_id] ?? null,
    };

    sectionMap.get(section.name).push(cleanItem);
    stats.included++;
  }

  // ── Sort items within each section ───────────────────────────────────────

  for (const [, items] of sectionMap) {
    items.sort((a, b) => {
      // Pinned items first (lower sort_override number = higher up)
      const oa = a._sort_override;
      const ob = b._sort_override;
      if (oa !== null && ob !== null) return oa - ob;
      if (oa !== null) return -1;
      if (ob !== null) return 1;
      // Alphabetical fallback
      return a.name.localeCompare(b.name);
    });
    // Strip internal sort key from output
    items.forEach((item) => delete item._sort_override);
  }

  // ── Assemble final menu ───────────────────────────────────────────────────

  const sections = config.sections
    .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
    .map((s) => ({
      name:  s.name,
      items: sectionMap.get(s.name) ?? [],
    }))
    .filter((s) => s.items.length > 0); // drop empty sections

  const menu = {
    location_id:       locationId,
    location_name:     config.location_display_name ?? locationId,
    generated_at:      new Date().toISOString(),
    source_fetched_at: fetchedAt,
    section_count:     sections.length,
    item_count:        stats.included,
    sections,
    _build_stats: {
      input_total:          allItems.length,
      excluded_archived:    stats.excluded_archived,
      excluded_no_section:  stats.excluded_no_section,
      excluded_keyword:     stats.excluded_keyword,
      excluded_no_price:    stats.excluded_no_price,
      hidden_sold_out:      stats.hidden_sold_out,
      included:             stats.included,
      unavailable_behavior: unavailableBehavior,
    },
  };

  // ── Write output ──────────────────────────────────────────────────────────

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(menu, null, 2));

  console.log(`\n✅  Build complete.`);
  console.log(`    Sections: ${menu.section_count} | Items: ${menu.item_count}`);
  console.log(`    Excluded: ${stats.excluded_archived} archived | ${stats.excluded_no_section} no section | ${stats.excluded_keyword} keyword | ${stats.excluded_no_price} no price`);
  if (stats.hidden_sold_out > 0) {
    console.log(`    Hidden (sold out, behavior=hide): ${stats.hidden_sold_out}`);
  }
  console.log(`\n📄  Saved to output/menu.json\n`);
  console.log("    Sections:");
  sections.forEach((s) => {
    const soldOut = s.items.filter((i) => i.sold_out).length;
    console.log(
      `      • ${s.name.padEnd(28)} ${String(s.items.length).padStart(3)} items` +
      (soldOut > 0 ? `  (${soldOut} sold out)` : "")
    );
  });
}

buildMenu();
