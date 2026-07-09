/**
 * menu.js — Five Daughters Bakery Digital Menu Board
 *
 * Fetches menu.json, renders the menu, and auto-refreshes every 60s.
 * On fetch failure: keeps the last successful menu and shows a polished
 * error state. Never leaves the screen stuck on "Loading menu…".
 *
 * No framework dependencies — plain ES2020 JavaScript.
 */

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────

  /**
   * Path to menu.json.
   *
   * Uses an absolute path from the repo root so this works correctly
   * regardless of whether the page is served locally or from GitHub Pages
   * at any subdirectory depth.
   *
   * Local (npm run preview):  http://localhost:3000/output/menu.json
   * GitHub Pages:             https://jwal7000.github.io/menu-display/output/menu.json
   *
   * If you move this repo or rename it, update BASE_PATH below.
   */
  const BASE_PATH        = window.location.hostname === "localhost" ||
                           window.location.hostname === "127.0.0.1"
                             ? ""
                             : "/menu-display";
  const MENU_JSON_PATH   = BASE_PATH + "/output/menu.json";
  const REFRESH_INTERVAL = 60 * 1000; // 60 seconds

  // ── Element refs ──────────────────────────────────────────────────────────

  const menuRoot         = document.getElementById("menu-root");
  const locationNameEl   = document.getElementById("location-name");
  const connectionWarn   = document.getElementById("connection-warning");
  const footerLocationEl = document.getElementById("footer-location");
  const footerUpdatedEl  = document.getElementById("footer-updated");

  // ── State ─────────────────────────────────────────────────────────────────

  let lastGoodMenu = null;
  let isFirstLoad  = true;

  // ── Utilities ─────────────────────────────────────────────────────────────

  function formatFullTimestamp(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function setWarning(visible) {
    if (visible) {
      connectionWarn.classList.remove("hidden");
      document.body.classList.add("has-warning");
    } else {
      connectionWarn.classList.add("hidden");
      document.body.classList.remove("has-warning");
    }
  }

  function showErrorState(message) {
    menuRoot.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "error-state";

    const icon = document.createElement("div");
    icon.className = "error-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "✦";

    const msg = document.createElement("p");
    msg.className = "error-message";
    msg.textContent = message;

    const sub = document.createElement("p");
    sub.className = "error-sub";
    sub.textContent = "This page will retry automatically every 60 seconds.";

    wrap.appendChild(icon);
    wrap.appendChild(msg);
    wrap.appendChild(sub);
    menuRoot.appendChild(wrap);
  }

  // ── DOM builders ──────────────────────────────────────────────────────────

  function buildItemRow(item) {
    const li = document.createElement("li");
    li.className = "item-row" + (item.sold_out ? " sold-out" : "");

    const nameEl = document.createElement("span");
    nameEl.className = "item-name";
    nameEl.textContent = item.name;

    const dotsEl = document.createElement("span");
    dotsEl.className = "item-dots";
    dotsEl.setAttribute("aria-hidden", "true");

    const priceEl = document.createElement("span");
    if (item.sold_out) {
      priceEl.className = "item-sold-out-label";
      priceEl.textContent = "Sold Out";
    } else {
      priceEl.className = "item-price";
      priceEl.textContent = item.price ?? "";
    }

    li.appendChild(nameEl);
    li.appendChild(dotsEl);
    li.appendChild(priceEl);

    // Multi-variation items (e.g. Poppi soda flavors)
    if (Array.isArray(item.variations) && item.variations.length > 1) {
      li.classList.add("has-variations");
      dotsEl.style.display = "none";
      priceEl.style.display = "none";

      const varList = document.createElement("ul");
      varList.className = "item-variations";

      for (const v of item.variations) {
        const varLi = document.createElement("li");
        varLi.className = "variation-row" + (v.sold_out ? " sold-out" : "");

        const vName = document.createElement("span");
        vName.className = "variation-name";
        vName.textContent = v.variation_name ?? "";

        const vDots = document.createElement("span");
        vDots.className = "variation-dots";
        vDots.setAttribute("aria-hidden", "true");

        const vPrice = document.createElement("span");
        if (v.sold_out) {
          vPrice.className = "variation-sold-out-label";
          vPrice.textContent = "Sold Out";
        } else {
          vPrice.className = "variation-price";
          vPrice.textContent = v.price ?? "";
        }

        varLi.appendChild(vName);
        varLi.appendChild(vDots);
        varLi.appendChild(vPrice);
        varList.appendChild(varLi);
      }

      li.appendChild(varList);
    }

    return li;
  }

  function buildSectionCard(section) {
    const card = document.createElement("div");
    card.className = "section-card";

    const header = document.createElement("div");
    header.className = "section-header";
    const title = document.createElement("h2");
    title.className = "section-name";
    title.textContent = section.name;
    header.appendChild(title);
    card.appendChild(header);

    const items = section.items ?? [];

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "section-empty";
      empty.textContent = "Nothing available right now";
      card.appendChild(empty);
      return card;
    }

    const list = document.createElement("ul");
    list.className = "item-list";
    list.setAttribute("aria-label", section.name + " items");
    for (const item of items) {
      list.appendChild(buildItemRow(item));
    }
    card.appendChild(list);
    return card;
  }

  function renderMenu(data) {
    const locName = data.location_name ?? "";
    const ts      = data.generated_at  ?? "";

    if (locationNameEl)   locationNameEl.textContent  = locName;
    if (footerLocationEl) footerLocationEl.textContent = locName;
    if (footerUpdatedEl)  footerUpdatedEl.textContent  =
      ts ? "Last updated " + formatFullTimestamp(ts) : "";

    const grid = document.createElement("div");
    grid.className = "sections-grid";

    for (const section of (data.sections ?? [])) {
      grid.appendChild(buildSectionCard(section));
    }

    if (!grid.hasChildNodes()) {
      showErrorState("No menu sections available.");
      return;
    }

    menuRoot.innerHTML = "";
    menuRoot.appendChild(grid);
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  async function fetchMenu() {
    if (!isFirstLoad) {
      document.body.classList.add("refreshing");
    }

    // Log the exact URL being fetched so it's easy to debug in DevTools
    const url = MENU_JSON_PATH + "?t=" + Date.now();
    console.log("[menu.js] Fetching:", url);

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} — ${url}`);
      }

      const data = await response.json();

      lastGoodMenu = data;
      renderMenu(data);
      setWarning(false);
      isFirstLoad = false;

    } catch (err) {
      console.error("[menu.js] Failed to load menu.json:", err.message);
      console.error("[menu.js] Attempted path:", url);

      if (lastGoodMenu) {
        // Keep showing last good menu with warning banner
        setWarning(true);
      } else {
        // First load failed — show polished error, not indefinite spinner
        showErrorState("Unable to load the menu right now.");
        setWarning(true);
      }
    } finally {
      document.body.classList.remove("refreshing");
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  fetchMenu();
  setInterval(fetchMenu, REFRESH_INTERVAL);

})();
