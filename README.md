# square-digital-menu-poc

Read-only proof of concept that pulls Square location and catalog data and converts it into a clean `menu.json` file for a future digital menu board.

---

## Safety Rules

- **Read-only only** — this project uses Square GET endpoints exclusively. No create, update, delete, or mutation calls.
- **Never commit `.env`** — credentials live only in your local `.env` file.
- **Never print the access token** — the scripts are written to avoid logging credentials.

---

## Prerequisites

- Node.js 18+ (project uses ESM `import` syntax)
- A Square Developer account with a production or sandbox access token

---

## Setup

### 1. Install dependencies

```bash
cd square-digital-menu-poc
npm install
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your Square access token:

```
SQUARE_ACCESS_TOKEN=your_token_here
SQUARE_ENVIRONMENT=production
```

Get your access token from: https://developer.squareup.com/apps

> Use `SQUARE_ENVIRONMENT=sandbox` if you want to test against Square's sandbox environment.

---

## Usage

### List all Square locations

```bash
npm run list-locations
```

Output saved to `output/locations.json`. Copy a location ID into `SQUARE_LOCATION_ID` in your `.env`.

---

### Configure the menu board

Edit `menu_config.json` to control what appears on the menu board — no code changes needed.

| Setting | Description |
|---|---|
| `sections[]` | Define display sections and which Square categories map into each |
| `sections[].square_categories` | One or more Square category names that feed this section |
| `sections[].sort_order` | Order sections appear on the board |
| `unavailable_items.behavior` | `show_as_sold_out` or `hide` |
| `hidden_item_keywords` | Items whose names contain any of these strings are excluded |
| `hidden_variation_ids` | Hide specific Square variation IDs (e.g. discontinued flavors) |
| `display_name_overrides` | Map Square item_id → display name shown on board |
| `price_overrides` | Map Square variation_id → display price string (visual only, does not change Square) |
| `item_sort_overrides` | Map Square item_id → sort position within its section (lower = higher up) |

---

### Fetch catalog for a location

Requires `SQUARE_LOCATION_ID` set in `.env`.

```bash
npm run fetch-catalog
```

Outputs:
- `output/catalog_raw.json` — full raw Square API objects (items, variations, categories, images)
- `output/menu_raw.json` — cleaned, menu-oriented structure

**Fields included in `menu_raw.json` per item:**

| Field | Description |
|---|---|
| `item_id` | Square catalog item ID |
| `item_name` | Display name |
| `category_name` | Category (e.g. "Hundred Layer Donuts") |
| `description` | Item description |
| `image_url` | Primary image URL |
| `is_archived` | Whether item is archived/hidden |
| `present_at_all_locations` | Global availability flag |
| `present_at_location_ids` | Locations explicitly included |
| `absent_at_location_ids` | Locations explicitly excluded |
| `any_variation_sold_out` | True if any variation is marked sold out |
| `price_range` | Price string or range across variations |
| `variations[]` | Array of variation objects (see below) |

**Per variation:**

| Field | Description |
|---|---|
| `variation_id` | Square variation ID |
| `variation_name` | e.g. "Regular", "Mini" |
| `sku` | SKU if set |
| `price` | Formatted price (location override → default) |
| `price_type` | `FIXED_PRICING` or `VARIABLE_PRICING` |
| `sold_out` | Location-level sold-out flag from Square |
| `inventory_quantity` | Current inventory count (from Inventory API) |
| `inventory_state` | e.g. `IN_STOCK`, `SOLD_OUT` |
| `inventory_alert_type` | Low-stock alert type if configured |
| `inventory_alert_threshold` | Low-stock threshold if configured |

---

### Preview the menu board

Run the full pipeline, then start the local preview server:

```bash
# 1. Fetch live Square data (requires .env with credentials)
npm run fetch-catalog

# 2. Build the display-ready menu.json
npm run build-menu

# 3. Start local preview server
npm run preview
```

Then open in a browser: **http://localhost:3000/public/**

For TV display, open in fullscreen mode (`F11` on most browsers) on a 16:9 screen.
The menu auto-refreshes every 60 seconds. If `menu.json` fails to load, the last
successful menu stays on screen with a subtle warning banner.

> **Note:** If you see a blank menu, make sure `npm run build-menu` has been run
> and that `output/menu.json` exists before starting the preview server.

---

## Project Structure

```
square-digital-menu-poc/
├── src/
│   ├── listLocations.js      # Lists all Square locations → output/locations.json
│   ├── fetchCatalog.js       # Fetches catalog + inventory → output/menu_raw.json
│   └── buildMenu.js          # Combines menu_raw.json + menu_config.json → output/menu.json
├── public/
│   ├── index.html            # Menu board webpage (16:9 TV display)
│   ├── styles.css            # Dark theme, large text, 16:9 layout
│   └── menu.js               # Loads menu.json, auto-refreshes, handles offline
├── output/                   # Generated JSON files (gitignored)
├── menu_config.json          # Display rules — edit to tune the menu board
├── .env.example              # Template for credentials
├── .gitignore
├── package.json
└── README.md
```

---

## Catalog Data Findings

> Analysis based on FDB Square catalog DB (square_tn) cross-referenced against the `menu_raw.json` mock generated 2026-07-08. Covers 12th South (location ID: `AX2YMJVN8QJ7C`) as the reference location. Findings apply broadly to all TN locations.

---

### 1. Item names, variation names, categories, and prices

**Item names: ✅ Clean and usable**
Core product names (`The Purist`, `Chocolate Sea Salt`, `Blueberry Lavender`, `Roll - Cinnamon Glaze`, etc.) are clean display-ready strings requiring no transformation. No encoding issues observed in core categories.

**Variation names: ⚠️ Mostly fine, one issue**
Most HLD items have a single variation called `Regular` — this is not meaningful on a menu board and should be suppressed when it's the only variation. Beverage items use variation names correctly (flavor names: `Ginger Lime`, `Strawberry Lemon`) and these should be displayed.

**Categories: ⚠️ Mixed — requires filtering (see #2)**

**Prices: ⚠️ Two issues**
- **Null prices:** ~110 active variations have no price set (10% of active catalog). These are mostly seasonal placeholders, historical items, or internal-use variations. A null-price guard is required before display.
- **Duplicate variations with mismatched prices:** Some items have two `Regular` variations at different price points (e.g., a legacy $2.00 and a current $3.75 for the same cookie). These are stale duplicates, not intentional size tiers. `buildMenu.js` should select the variation with a valid SKU and/or highest ordinal.

---

### 2. Categories — usability for menu board grouping

**Customer-facing categories (safe to display):**

| Category | Notes |
|---|---|
| Hundred Layer Donuts | Core product — ✅ |
| Mini Hundred Layer Donuts | Core product — ✅ |
| Paleo | ✅ |
| Yeast Raised Donuts | ✅ |
| Rolls | ✅ |
| Cookies | ✅ (see also `Cookie` and `Day Old Cookies` — may need merging) |
| Pastries | ✅ |
| Beverages | ✅ |
| Coffee | ✅ |
| Breakfast | ✅ |
| Savory | ✅ |
| Quinnamon/Quinn | ✅ |

**Internal categories — must be excluded:**

| Category | Reason |
|---|---|
| Sales Spoilage/Waste | Waste tracking — internal only |
| Kitchen Spoilage/Waste | Kitchen tracking — internal only |
| Spoilage/Waste | Legacy waste category |
| Unsellable | Damaged/internal product tracking |
| TEST | Development items |
| Pre-Orders | Order management, not menu display |
| Fees & Add-ons | Transaction fees |
| A La Carte | Internal modifier-style items |
| Wholesale (Coffee Shop) | B2B pricing — not customer-facing |
| Merch / Merchandise - Clothing / Merchandise - Other / Shirts | Not food — separate display if needed |
| 100 Layer Donuts - November Seasonal Flavors | Legacy seasonal category, should merge into HLD or be excluded when not active |

**Edge cases:**
- `Cookie` vs `Cookies` vs `Day Old Cookies` — three separate categories for effectively the same product type. The build script should normalize these.
- `Grab and Go`, `Lunch`, `Bread`, `Brioche`, `Chef Specials` — location-specific or seasonal, verify presence before displaying.

---

### 3. Location-specific presence fields

**✅ Working correctly.** Both `present_at_all_locations` (boolean) and `present_at_location_ids` / `absent_at_location_ids` (arrays) are populated and functional. The `fetchCatalog.js` script correctly filters on these. Spot-checking confirms that items tagged to specific locations (e.g., `Birthday Cake Purist - 12th South`) appear with the correct location ID in `present_at_location_ids`.

One nuance: some items are `present_at_all_locations: true` but have no explicit location IDs — these are correctly treated as available everywhere and pass through the filter as expected.

---

### 4. Unavailable, hidden, sold-out, and availability fields

**`is_deleted` (catalog_object level): ✅ Reliable**
The Square API does not return deleted objects by default — `is_deleted` items will not appear in live API output. In the DB, 1,660 of 2,401 items are deleted; only 741 active items remain. The live API already handles this.

**`is_archived` (item level): ✅ Present**
Archived items are still returned by the API but should be excluded from display. The `fetchCatalog.js` captures this field.

**`sold_out` (location override level): ✅ Present but sparsely used**
Square supports a `sold_out` flag per variation per location in `locationOverrides`. This field is captured by `fetchCatalog.js`. However, FDB does not appear to use this flag systematically in daily operations — it is not a reliable real-time sold-out signal on its own.

**`inventory_state` / `inventory_quantity` (Inventory API): ⚠️ Present but limited for food**
Inventory tracking via Square's Inventory API is more commonly used for merchandise (apparel with size/quantity) than for made-to-order food items. Donut inventory is not tracked at the unit level in Square — the Inventory API will return null counts for most food items. **Do not rely on inventory counts to power a sold-out display for donuts.** A real-time sold-out signal would require a separate integration (e.g., a store-side toggle, Shopify out-of-stock webhook, or a custom field).

**`availability_period_ids`: ⚠️ Present but not in use**
This Square field supports time-based availability windows (e.g., breakfast items only available 7–11 AM). FDB does not currently configure these. Not actionable for V1.

---

### 5. Duplicate items and internal/test items

**Duplicates:**
- Active duplicate items by name: `Hat, Black` (2 copies), `Hot Chocolate` (2 copies). Likely stale catalog entries from location-specific clones.
- More common: duplicate *variations* on a single item — same name (`Regular`), different prices. Indicates catalog cleanup has not been done systematically. The build script must handle this.
- Some items have location-name suffixes baked in (e.g., `Birthday Cake Purist - 12th South`, `Birthday Cake Purist - East Nashville`) — these are location-specific SKUs, not duplicates, and should be treated as such.

**Internal/test items requiring exclusion:**
- `TEST` category: 2 items
- `Unsellable` category: 11 items
- `Sales Spoilage/Waste` category: 66 items
- `Kitchen Spoilage/Waste` category: 25 items
- `Spoilage/Waste` category: 54 items
- Items named with prefixes `Blank`, `Unsellable -`, `Sales Spoilage/Waste -`, `Kitchen Spoilage/Waste -` — filter by name pattern as a secondary safeguard
- Wholesale items (SKUs ending in `999`, category `Wholesale (Coffee Shop)`)

**Total internal items to filter: ~160+ across waste, test, wholesale, and unsellable categories.**

---

### 6. Modifier lists and option sets

**51 modifier lists exist in the catalog.** Named examples include:
- `Flavor` — likely used for coffee drink customization
- `Add Syrup`, `Biscuit`, `Sandwich`, `Croissant` — build/modifier options for breakfast/coffee items
- `ALLERGY` — allergy flagging
- `Spoilage - Espresso Beverages`, `Spoilage - Quantity Measurements` — internal waste modifiers
- `Waterloo`, `Donated` — operational modifiers

**For a digital menu board: modifier lists are not needed for V1.** A menu board displays what's available, not a full ordering interface. Modifiers become relevant only if the board becomes interactive (order-entry capable). Exclude from `menu.json` for now; document for future phases.

---

### 7. Fields to include in final `menu.json`

```json
{
  "item_id": "...",
  "item_name": "...",
  "category_name": "...",
  "description": "...",
  "image_url": "...",
  "price": "4.50 USD",
  "variations": [
    {
      "variation_id": "...",
      "variation_name": "...",
      "price": "...",
      "sold_out": false
    }
  ],
  "any_variation_sold_out": false
}
```

**Include:**
- `item_id`, `item_name`, `category_name`
- `description` (when non-null)
- `image_url` (when available — sparse currently)
- `price` / `price_range` (guard for null)
- `variations[]` — only when multiple meaningful variations exist (suppress single `Regular`)
- `variation_name` — only for multi-flavor items (beverages, merch sizes)
- `any_variation_sold_out` — for future sold-out display logic
- `sold_out` per variation — for flavor-level sold-out display

---

### 8. Fields to exclude from customer-facing display

| Field | Reason |
|---|---|
| `item_id`, `variation_id` | Internal IDs — keep in JSON for system use, hide from display layer |
| `sku` | Internal reference |
| `category_id` | Internal reference |
| `present_at_all_locations`, `present_at_location_ids`, `absent_at_location_ids` | Used for filtering only — not display |
| `is_archived` | Used for filtering only |
| `availability_period_ids` | Not in use |
| `inventory_quantity`, `inventory_state` | Unreliable for food items |
| `inventory_alert_type`, `inventory_alert_threshold` | Internal operations |
| `price_type` | Internal |
| `ordinal` | Internal sort order |
| `location_present_at_all`, `location_present_ids`, `location_absent_ids` | Filtering only |

---

### 9. Missing or ambiguous data

| Issue | Detail |
|---|---|
| **Images** | Zero images stored in the Fivetran-synced DB. Live Square API returns image URLs for items with photos uploaded in Square Dashboard. Image coverage is unknown until the live script runs — expected to be partial. |
| **Descriptions** | Most FDB items have no description field populated in Square. Not a blocker for V1 but limits richness of display. |
| **Real-time sold-out** | No reliable per-item sold-out signal for food items. Requires a separate mechanism (e.g., store-facing toggle app, daily sync). |
| **Active vs. seasonal items** | No flag distinguishes currently-offered seasonal items from off-season catalog entries with no price. Null price is the best proxy. |
| **Modifier lists** | 51 modifier lists are cataloged but their item associations are not fully inspected — some may be attached to core food items and affect display. |
| **Category duplication** | `Cookie` vs `Cookies` vs `Day Old Cookies` needs a business decision on merge/rename before the display schema is finalized. |
| **Location-specific item name suffixes** | Items like `Birthday Cake Purist - 12th South` suggest some catalog management was done at item level rather than location level. These may create confusing names if not renamed or filtered. |

---

### 10. Recommended next step

**Build `src/buildMenu.js` with the following filter and transform logic:**

1. **Exclude categories** on a blocklist: `Sales Spoilage/Waste`, `Kitchen Spoilage/Waste`, `Spoilage/Waste`, `Unsellable`, `TEST`, `Pre-Orders`, `Fees & Add-ons`, `A La Carte`, `Wholesale (Coffee Shop)`, `Merch`, `Merchandise - Clothing`, `Merchandise - Other`, `Shirts`
2. **Exclude items** with name prefixes: `Blank`, `Unsellable -`, `Sales Spoilage/Waste -`, `Kitchen Spoilage/Waste -`
3. **Exclude items with null price** on all variations (seasonal placeholders)
4. **Deduplicate variations** — if multiple `Regular` variations exist on one item, keep the one with a valid SKU or the highest price
5. **Suppress variation name** when there is only one variation named `Regular`
6. **Normalize cookie categories** — merge `Cookie`, `Cookies`, `Day Old Cookies` into `Cookies`
7. **Output one `menu.json` per location** containing only display-ready items

This approach is safe, conservative, and reversible — no Square data is modified at any point.

---

## Roadmap

- [x] List locations → `output/locations.json`
- [x] Fetch catalog + inventory for a location → `output/catalog_raw.json`, `output/menu_raw.json`
- [x] `menu_config.json` — config-driven display rules (sections, overrides, sold-out behavior)
- [x] `buildMenu.js` — combines Square data + config → `output/menu.json`
- [x] `public/` — digital menu board webpage (HTML/CSS/JS, 16:9 TV display)
- [ ] Multi-location support (one `menu_config.json` per location)
- [ ] Image support once live API confirms coverage
- [ ] Real-time sold-out signal integration (future phase)
