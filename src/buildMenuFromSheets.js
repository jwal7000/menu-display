/**
 * buildMenuFromSheets.js
 * Reads menu data from a Google Sheet and generates output/menu.json
 * for display on digital menu boards.
 *
 * No Square API calls. No mutations. Pure data shaping from sheet → menu.
 *
 * Usage:
 *   npm run build-menu-sheets
 *
 * Environment:
 *   GOOGLE_SHEETS_ID — the Google Sheet ID (e.g. 1abc...xyz)
 *   GOOGLE_CREDENTIALS_PATH — path to service account JSON (default: ~/.config/gcloud/service-account.json)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { google } from "googleapis";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT_DIR, "output");

// ── Environment & Config ─────────────────────────────────────────────────

const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const CREDS_PATH = process.env.GOOGLE_CREDENTIALS_PATH || "~/.openclaw/secrets/gcp-sheets-key.json";

if (!SHEETS_ID) {
  console.error("❌  GOOGLE_SHEETS_ID environment variable not set.");
  console.error("    Set it to your Google Sheet ID and try again.");
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Expand ~ to home directory.
 */
function expandPath(p) {
  if (p.startsWith("~")) {
    return p.replace("~", process.env.HOME || "").replace("//", "/");
  }
  return p;
}

/**
 * Load Google service account credentials and return an authorized Sheets client.
 */
async function getAuthenticatedSheetsClient() {
  const credsFile = expandPath(CREDS_PATH);
  let credentials;
  try {
    credentials = JSON.parse(readFileSync(credsFile, "utf8"));
  } catch (err) {
    console.error(`❌  Could not read credentials from ${credsFile}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

/**
 * Get the name of the first sheet tab (so we don't depend on a fixed tab name).
 */
async function getFirstSheetName(sheets, sheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const firstSheet = meta.data.sheets?.[0];
  if (!firstSheet) {
    console.error("❌  No sheets found in spreadsheet.");
    process.exit(1);
  }
  return firstSheet.properties.title;
}

/**
 * Fetch raw sheet data from Google Sheets.
 */
async function fetchSheetData(sheets, sheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });
    return response.data.values || [];
  } catch (err) {
    console.error(`❌  Could not fetch sheet data from ${range}`);
    console.error(`    ${err.message}`);
    process.exit(1);
  }
}

/**
 * Parse a price string like "$4.50" or "4.50" → cents (number).
 */
function parsePriceCents(priceStr) {
  if (!priceStr) return null;
  const match = String(priceStr).match(/([\d.]+)/);
  return match ? Math.round(parseFloat(match[1]) * 100) : null;
}

/**
 * Format cents → "$4.50"
 */
function formatPrice(cents) {
  if (cents === null || cents === undefined) return null;
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parse a boolean string.
 */
function parseBool(val) {
  if (!val) return false;
  return String(val).toLowerCase().trim() === "true";
}

/**
 * Parse a number, return null if invalid.
 */
function parseNum(val) {
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function buildMenuFromSheets() {
  console.log(`📄  Google Sheets ID: ${SHEETS_ID}`);
  console.log(`🔐  Credentials:     ${expandPath(CREDS_PATH)}`);

  // Authenticate with Google Sheets API
  const sheets = await getAuthenticatedSheetsClient();
  console.log(`✅  Authenticated with Google Sheets\n`);

  // Discover tab name and fetch data
  const tabName = await getFirstSheetName(sheets, SHEETS_ID);
  console.log(`📋  Sheet tab:        "${tabName}"`);
  const sheetData = await fetchSheetData(sheets, SHEETS_ID, tabName);

  if (sheetData.length === 0) {
    console.error(`❌  Sheet tab "${tabName}" is empty.`);
    process.exit(1);
  }

  // Parse headers (Row 1)
  const headers = sheetData[0];
  const headerIndices = {
    Location: headers.indexOf("Location"),
    Section: headers.indexOf("Section"),
    ItemId: headers.indexOf("Item ID"),
    ItemName: headers.indexOf("Item Name"),
    Price: headers.indexOf("Price"),
    SoldOut: headers.indexOf("Sold Out"),
    Description: headers.indexOf("Description"),
    ImageUrl: headers.indexOf("Image URL"),
    SectionSortOrder: headers.indexOf("Section Sort Order"),
    ItemSortOrder: headers.indexOf("Item Sort Order"),
    VariationName: headers.indexOf("Variation Name"),
    VariationId: headers.indexOf("Variation ID"),
  };

  // Validate critical headers
  const critical = ["Location", "Section", "ItemId", "ItemName", "Price"];
  for (const h of critical) {
    if (headerIndices[h] === -1) {
      console.error(`❌  Missing required column: ${h}`);
      process.exit(1);
    }
  }

  console.log(`📋  Headers found: ${headers.length} columns`);
  console.log(`📦  Data rows:     ${sheetData.length - 1} items\n`);

  // Parse data rows
  const rows = sheetData.slice(1).filter((row) => row && row.length > 0);

  // Group by location
  const locationMap = new Map();

  for (const row of rows) {
    const location = (row[headerIndices.Location] || "").trim();
    const section = (row[headerIndices.Section] || "").trim();
    const itemId = (row[headerIndices.ItemId] || "").trim();
    const itemName = (row[headerIndices.ItemName] || "").trim();
    const priceStr = (row[headerIndices.Price] || "").trim();
    const soldOut = parseBool(row[headerIndices.SoldOut]);
    const description = (row[headerIndices.Description] || "").trim();
    const imageUrl = (row[headerIndices.ImageUrl] || "").trim();
    const sectionSortOrder = parseNum(row[headerIndices.SectionSortOrder]);
    const itemSortOrder = parseNum(row[headerIndices.ItemSortOrder]);
    const variationName = (row[headerIndices.VariationName] || "").trim();
    const variationId = (row[headerIndices.VariationId] || "").trim();

    // Skip blank rows
    if (!location || !itemId || !itemName) continue;

    if (!locationMap.has(location)) {
      locationMap.set(location, {
        location_name: location,
        sections: new Map(),
        timestamp: new Date().toISOString(),
      });
    }

    const locData = locationMap.get(location);

    if (!locData.sections.has(section)) {
      locData.sections.set(section, {
        name: section,
        sort_order: sectionSortOrder,
        items: new Map(),
      });
    }

    const sectionData = locData.sections.get(section);

    // Get or create item
    if (!sectionData.items.has(itemId)) {
      sectionData.items.set(itemId, {
        item_id: itemId,
        name: itemName,
        sold_out: soldOut,
        description,
        image_url: imageUrl,
        sort_order: itemSortOrder,
        variations: [],
        _variation_ids: new Set(),
      });
    }

    const item = sectionData.items.get(itemId);

    // Handle variations
    if (variationId) {
      if (!item._variation_ids.has(variationId)) {
        const cents = parsePriceCents(priceStr);
        item.variations.push({
          variation_id: variationId,
          variation_name: variationName,
          price: formatPrice(cents),
          sold_out: soldOut,
          _cents: cents,
        });
        item._variation_ids.add(variationId);
      }
    }

    // Update item-level price if no variations yet
    if (item.variations.length === 0) {
      const cents = parsePriceCents(priceStr);
      item._price_cents = cents;
    }
  }

  // ── Build final menu for each location ──────────────────────────────────

  for (const [location, locData] of locationMap) {
    console.log(`\n📍  Location: ${location}`);

    // Sort sections
    const sections = Array.from(locData.sections.values()).sort(
      (a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99)
    );

    const builtSections = [];
    let totalItems = 0;

    for (const sectionData of sections) {
      // Build items for this section
      const items = Array.from(sectionData.items.values());

      // Sort items within section
      items.sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));

      // Process variations and finalize item format
      const cleanItems = [];
      for (const item of items) {
        // Clean up temporary fields
        delete item._variation_ids;

        // If we have variations, calculate min/max price
        if (item.variations && item.variations.length > 0) {
          const cents = item.variations.map((v) => v._cents).filter((c) => c !== null);
          if (cents.length > 0) {
            const minCents = Math.min(...cents);
            const maxCents = Math.max(...cents);
            item.price =
              minCents === maxCents
                ? formatPrice(minCents)
                : `${formatPrice(minCents)} – ${formatPrice(maxCents)}`;
          }
          // Clean variation format
          item.variations = item.variations.map((v) => {
            const clean = {
              variation_id: v.variation_id,
              price: v.price,
              sold_out: v.sold_out,
            };
            if (v.variation_name) clean.variation_name = v.variation_name;
            delete v._cents;
            return clean;
          });
        } else {
          // Single item (no variations)
          if (item._price_cents !== undefined) {
            item.price = formatPrice(item._price_cents);
          }
          delete item._price_cents;
          delete item.variations;
        }

        // Remove empty optional fields
        if (!item.description) delete item.description;
        if (!item.image_url) delete item.image_url;
        if (!item.sold_out) delete item.sold_out;

        delete item.sort_order;
        cleanItems.push(item);
      }

      if (cleanItems.length > 0) {
        builtSections.push({
          name: sectionData.name,
          items: cleanItems,
        });
        totalItems += cleanItems.length;
      }
    }

    // Assemble final menu object
    const menu = {
      location_id: location, // Using location name as ID
      location_name: location,
      generated_at: new Date().toISOString(),
      source_fetched_at: locData.timestamp,
      section_count: builtSections.length,
      item_count: totalItems,
      sections: builtSections,
    };

    // Write output/menu.json
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(resolve(OUTPUT_DIR, "menu.json"), JSON.stringify(menu, null, 2));

    console.log(`✅  Build complete.`);
    console.log(`    Sections: ${menu.section_count} | Items: ${menu.item_count}`);
    console.log(`\n📄  Saved to output/menu.json\n`);
    console.log("    Sections:");
    builtSections.forEach((s) => {
      const soldOut = s.items.filter((i) => i.sold_out).length;
      console.log(
        `      • ${s.name.padEnd(28)} ${String(s.items.length).padStart(3)} items` +
          (soldOut > 0 ? `  (${soldOut} sold out)` : "")
      );
    });
  }
}

buildMenuFromSheets().catch((err) => {
  console.error("❌  Fatal error:", err.message);
  process.exit(1);
});
