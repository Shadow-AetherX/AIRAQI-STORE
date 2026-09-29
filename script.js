/* =====================================================================
   AL-IRAQI HOME APPLIANCES — كتالوج الجملة — script.js
   Static Website + Data (Google Sheet CSV) + LocalStorage + WhatsApp
   ---------------------------------------------------------------------
   تعديلات هذه النسخة (فوق النسخة السابقة):
   ✅ واتساب المنتج الواحد بقى يستخدم نفس Order Model (Cart = Invoice = WhatsApp).
   ✅ رسالة واتساب مضغوطة تلقائيًا للطلبات الطويلة بدل منع الإرسال مباشرة.
   ✅ Lightbox: عدّاد دايمًا (1 / 1)، Loading state، Swipe، Focus trap.
   ✅ معرض الكارت: تنقل بالكيبورد (أسهم / Enter) + عنصر قابل للتركيز.
   ✅ صور الفاتورة eager + الطباعة بتستنى تحميل الصور (بحد أقصى 4 ثواني).
   ✅ عدّاد الهيدر = عدد الأصناف (مش جمع كراتين وقطع في رقم واحد).
===================================================================== */

const CONFIG = {
  // مصدر البيانات: "sheet" (الإنتاج) أو "csv" أو "json" (تطوير محلي فقط)
  dataSource: "sheet",
  csvFilePath: "data/products.csv",
  googleSheetCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRy6tmzPEdxq6EcBxWh-bM_zR94kaYlZhHOxXa6LceOjFxZjxm0Qtr3Dy8GnYB99g/pub?gid=1444421128&single=true&output=csv",

  // رقم واتساب المؤسسة (صيغة دولية بدون + أو صفر)
  whatsappNumber: "201105236152",
  storeName: "AL-IRAQI HOME APPLIANCES",
  currency: "ج.م",
  defaultUnit: "carton",

  // التسعير بالكامل من الشيت (لا حساب ولا نسب زيادة هنا):
  //  - carton_price: سعر الكرتونة الثابت.
  //  - piece_price ("Base Price"): سعر القطعة المعروض حرفيًا.
  //  - carton_unit_price: بديل اختياري يُستخدم فقط لو carton_price فاضي (ضرب مباشر × عدد القطع).

  maxQuantity: 9999,
  cartStorageKey: "aliraqi_cart_v1",
  cartHintStorageKey: "aliraqi_cart_hint_shown_v1",
};

/* =====================================================================
   1) Data Contract: Aliases + Validation
===================================================================== */
const FIELD_ALIASES = {
  id: ["id", "code", "item_id", "sku", "كود", "كود الصنف", "كود المنتج"],
  name: ["name", "product_name", "title", "اسم", "اسم الصنف", "اسم المنتج"],
  category: ["category", "type", "القسم", "التصنيف", "قسم"],
  image: ["image", "img", "photo", "image_url", "صورة", "رابط الصورة", "الصورة"],
  pcs_per_carton: [
    "pcs_per_carton", "carton_qty", "pcs", "pieces_per_carton",
    "عدد القطع بالكرتونة", "عدد القطع في الكرتونة", "عدد القطعة بالكرتونة",
  ],
  piece_price: [
    "piece_price", "price_piece", "base_price", "baseprice", "base price",
    "بيس برايس", "البيس برايس", "سعر القطعة", "سعر_القطعة",
  ],
  carton_price: ["carton_price", "price_carton", "سعر الكرتونة", "سعر_الكرتونة"],
  carton_unit_price: [
    "carton_unit_price", "unit_price", "سعر القطعة في الكرتونة",
    "سعر القطعة اللي في الكرتونة", "سعر الوحدة", "سعر وحدة الكرتونة",
  ],
  availability: ["availability", "status", "التوفر", "الحالة", "متوفر"],
  description: ["description", "desc", "details", "الوصف", "تفاصيل"],
  badge: ["badge", "badges", "label", "tag", "شارة", "بادج", "ملصق"],
  featured: ["featured", "مميز", "منتج مميز"],
};

const AVAILABLE_VALUES = new Set(["available", "متوفر", "yes", "1", "true", "نعم"]);
const UNAVAILABLE_VALUES = new Set(["unavailable", "غير متوفر", "no", "0", "false", "لا"]);

function normalizeHeader(h) {
  if (h === undefined || h === null) return "";
  let s = String(h);
  s = s.replace(/^\uFEFF/, "");
  s = s.trim().replace(/\s+/g, " ");
  return s.toLowerCase();
}

function normalizeRowKeys(row) {
  const out = {};
  Object.keys(row || {}).forEach((k) => {
    const nk = normalizeHeader(k);
    if (nk && !(nk in out)) out[nk] = row[k];
  });
  return out;
}

function pickField(normRow, aliasList) {
  for (const alias of aliasList) {
    const nk = normalizeHeader(alias);
    if (nk in normRow) {
      const v = normRow[nk];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

function extractFields(normRow) {
  return {
    id: pickField(normRow, FIELD_ALIASES.id),
    name: pickField(normRow, FIELD_ALIASES.name),
    category: pickField(normRow, FIELD_ALIASES.category),
    imagesRaw: collectRawImageValues(normRow),
    pcs_per_carton: pickField(normRow, FIELD_ALIASES.pcs_per_carton),
    piece_price: pickField(normRow, FIELD_ALIASES.piece_price),
    carton_price: pickField(normRow, FIELD_ALIASES.carton_price),
    carton_unit_price: pickField(normRow, FIELD_ALIASES.carton_unit_price),
    availability: pickField(normRow, FIELD_ALIASES.availability),
    description: pickField(normRow, FIELD_ALIASES.description),
    badge: pickField(normRow, FIELD_ALIASES.badge),
    featured: pickField(normRow, FIELD_ALIASES.featured),
  };
}

const FEATURED_TRUE_VALUES = new Set(["1", "yes", "y", "true", "نعم", "✓", "featured", "مميز"]);

/** شارات نص عادي فقط (حد أقصى 2، 24 حرف لكل واحدة) — بتتعرض بـ textContent أبدًا مش HTML */
function parseBadges(rawBadge, rawFeatured) {
  const out = [];
  if (rawBadge !== undefined && rawBadge !== null) {
    String(rawBadge)
      .split(/[,،|؛;\n\r]+/)
      .forEach((part) => {
        const t = part.trim().replace(/\s+/g, " ").slice(0, 24);
        if (t && !out.includes(t)) out.push(t);
      });
  }
  if (
    rawFeatured !== undefined &&
    rawFeatured !== null &&
    FEATURED_TRUE_VALUES.has(String(rawFeatured).trim().toLowerCase()) &&
    !out.includes("مميز")
  ) {
    out.push("مميز");
  }
  return out.slice(0, 2);
}

function parseNumberSafe(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}
function isPositiveIntegerValue(n) {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}
function isNonNegativeFiniteNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function normalizeAvailability(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return "unavailable";
  const v = String(raw).trim().toLowerCase();
  if (AVAILABLE_VALUES.has(v)) return "available";
  if (UNAVAILABLE_VALUES.has(v)) return "unavailable";
  console.warn(`[Data] قيمة توفر غير معروفة: "${raw}" — تم اعتباره غير متوفر بشكل آمن.`);
  return "unavailable";
}

/** روابط الصور: http/https فقط (javascript: و data: مرفوضة) */
function isSafeImageUrl(raw) {
  if (!raw) return false;
  const v = String(raw).trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    new URL(v);
  } catch (e) {
    return false;
  }
  return true;
}

/** مسار صورة نسبي آمن داخل نفس الموقع (بدون scheme، بدون .. ، امتداد صورة معروف) */
function isSafeRelativeImagePath(raw) {
  if (!raw) return false;
  const v = String(raw).trim();
  if (/^https?:\/\//i.test(v)) return false;
  if (/^\/\//.test(v)) return false;
  if (v.includes(":")) return false;
  if (v.includes("..")) return false;
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(v);
}

function isSafeImageSrc(raw) {
  return isSafeImageUrl(raw) || isSafeRelativeImagePath(raw);
}

const IMAGE_LIST_DELIMITER_RE = /[,،|؛;\n\r]+/;

function collectRawImageValues(normRow) {
  const values = [];
  const base = pickField(normRow, FIELD_ALIASES.image);
  if (base !== undefined) values.push(base);
  Object.keys(normRow).forEach((key) => {
    if (/^(image|img|photo|صورة|الصورة)[\s_-]*\d+$/i.test(key)) {
      const v = normRow[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") values.push(v);
    }
  });
  return values;
}

function parseImageList(rawValues) {
  const all = [];
  (rawValues || []).forEach((raw) => {
    String(raw)
      .split(IMAGE_LIST_DELIMITER_RE)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((v) => all.push(v));
  });
  const valid = [];
  all.forEach((v) => {
    if (isSafeImageSrc(v) && !valid.includes(v)) valid.push(v);
  });
  return valid;
}

/** صورة بديلة محلية (SVG مُضمّن) — لا تعتمد على أي رابط خارجي */
const FALLBACK_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>" +
      "<rect width='400' height='400' fill='#f1f3f6'/>" +
      "<g fill='none' stroke='#c7cfd8' stroke-width='10'>" +
      "<circle cx='200' cy='150' r='55'/>" +
      "</g>" +
      "<path d='M120 300 L170 230 L215 270 L260 210 L300 300 Z' fill='#c7cfd8'/>" +
      "<text x='200' y='355' font-size='24' text-anchor='middle' font-family='sans-serif' fill='#9aa5b1'>لا توجد صورة</text>" +
      "</svg>"
  );

function resolveImageSrc(product, index) {
  const idx = typeof index === "number" ? index : 0;
  const list = (product && product.images) || [];
  return list[idx] || FALLBACK_IMAGE;
}

/** الـ fallback بيتفعّل مرة واحدة فقط لكل صورة (يمنع loop لو الـ fallback نفسه فشل) */
function attachImageFallback(imgEl) {
  imgEl.addEventListener("error", function onImgError() {
    if (imgEl.dataset.fallbackApplied === "1") return;
    imgEl.dataset.fallbackApplied = "1";
    imgEl.src = FALLBACK_IMAGE;
  });
}

function normalizeQuantity(raw, fallback) {
  const fb = typeof fallback === "number" && Number.isFinite(fallback) ? fallback : 1;
  let n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) n = fb;
  if (n < 1) n = 1;
  if (n > CONFIG.maxQuantity) n = CONFIG.maxQuantity;
  return n;
}

/**
 * تطبيع صف واحد إلى منتج نهائي، أو null لو غير صالح (id/name فارغ أو بدون أي سعر).
 * صف واحد غير صالح لا يكسر الكتالوج — بيتسجل تحذير في الـ Console فقط.
 */
function normalizeProductRow(fields, rowIndex) {
  const id = fields.id !== undefined ? String(fields.id).trim() : "";
  const name = fields.name !== undefined ? String(fields.name).trim() : "";

  if (!id) {
    console.warn(`[Data] تم تجاهل الصف #${rowIndex + 1}: كود الصنف (id) فارغ.`);
    return null;
  }
  if (!name) {
    console.warn(`[Data] تم تجاهل الصف #${rowIndex + 1} (كود: "${id}"): اسم الصنف فارغ.`);
    return null;
  }

  const category = fields.category ? String(fields.category).trim() : "";
  const description = fields.description ? String(fields.description).trim() : "";

  let pcsPerCarton = parseNumberSafe(fields.pcs_per_carton);
  if (pcsPerCarton !== null) {
    pcsPerCarton = Math.trunc(pcsPerCarton);
    if (!isPositiveIntegerValue(pcsPerCarton)) {
      console.warn(`[Data] "عدد القطع بالكرتونة" غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
      pcsPerCarton = null;
    }
  }

  let piecePrice = parseNumberSafe(fields.piece_price);
  let cartonPrice = parseNumberSafe(fields.carton_price);
  let cartonUnitPrice = parseNumberSafe(fields.carton_unit_price);

  if (piecePrice !== null && !isNonNegativeFiniteNumber(piecePrice)) {
    console.warn(`[Data] سعر القطعة غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
    piecePrice = null;
  }
  if (cartonPrice !== null && !isNonNegativeFiniteNumber(cartonPrice)) {
    console.warn(`[Data] سعر الكرتونة غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
    cartonPrice = null;
  }
  if (cartonUnitPrice !== null && !isNonNegativeFiniteNumber(cartonUnitPrice)) {
    console.warn(`[Data] "سعر القطعة في الكرتونة" غير صالح للصنف "${id}" — تم تجاهل القيمة.`);
    cartonUnitPrice = null;
  }

  // سعر الكرتونة الصريح له أولوية مطلقة. الاشتقاق (ضرب مباشر بدون نسبة) فقط لو الخانة فاضية.
  if (cartonPrice === null && cartonUnitPrice !== null && pcsPerCarton) {
    cartonPrice = Math.round(cartonUnitPrice * pcsPerCarton * 100) / 100;
  }

  if (piecePrice === null && cartonPrice === null) {
    console.warn(`[Data] تم تجاهل الصنف "${id}" (${name}): لا يوجد سعر صالح لا بالقطعة ولا بالكرتونة.`);
    return null;
  }

  return {
    // مفتاح داخلي فريد لهذا التحميل فقط (لا يُعرض) — صنفان بنفس الكود لا يتعارضان.
    _key: `row_${rowIndex}`,
    id,
    name,
    category: category || "أخرى",
    images: parseImageList(fields.imagesRaw),
    pcsPerCarton,
    piecePrice,
    cartonPrice,
    availability: normalizeAvailability(fields.availability),
    description,
    badges: parseBadges(fields.badge, fields.featured),
    _order: rowIndex,
  };
}

/* بيانات تجريبية — للتطوير المحلي فقط (dataSource = "json")، مش fallback عند فشل الشيت */
const SAMPLE_PRODUCTS = [
  {
    id: "GLS-2044",
    name: "طقم كاسات زجاج كلاسيك 6 قطع",
    category: "زجاجيات",
    image: "https://picsum.photos/seed/gls2044/500/500",
    pcs_per_carton: 48,
    piece_price: 15,
    carton_price: 620,
    availability: "available",
    description: "زجاج شفاف عالي الجودة، سُمك موحّد ومقاومة عالية للكسر.",
  },
  {
    id: "PLX-1032",
    name: "دولاب بلاستيك 4 أدراج",
    category: "بلاستيكيات",
    image: "https://picsum.photos/seed/plx1032/500/500",
    pcs_per_carton: 6,
    piece_price: 245,
    carton_price: 1350,
    availability: "unavailable",
    description: "تصميم عملي لتنظيم الأدوات المنزلية.",
  },
];

/* =====================================================================
   الحالة العامة (State)
===================================================================== */
let PRODUCTS = [];
let PRODUCT_MAP = new Map();
let ACTIVE_CATEGORY = "الكل";
let SEARCH_TERM = "";
let SORT_MODE = "default";
let searchDebounceTimer = null;
let lightboxTrigger = null;

/* السلة: المفتاح = "productKey::unit" — القيمة = { productKey, id, unit, qty } */
let CART = {};

const el = {
  grid: document.getElementById("catalogGrid"),
  cardTemplate: document.getElementById("cardTemplate"),

  loadingState: document.getElementById("loadingState"),
  loadErrorState: document.getElementById("loadErrorState"),
  retryLoadBtn: document.getElementById("retryLoadBtn"),
  noProductsState: document.getElementById("noProductsState"),
  emptyState: document.getElementById("emptyState"),
  resetFilters: document.getElementById("resetFilters"),

  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  filtersToggle: document.getElementById("filtersToggle"),
  filtersRow: document.getElementById("filtersRow"),
  filtersToggleDot: document.getElementById("filtersToggleDot"),

  categoryDropdown: document.getElementById("categoryDropdown"),
  categoryToggle: document.getElementById("categoryToggle"),
  categoryLabel: document.getElementById("categoryLabel"),
  categoryMenu: document.getElementById("categoryMenu"),

  cartBtn: document.getElementById("cartBtn"),
  cartCount: document.getElementById("cartCount"),
  cartPanel: document.getElementById("cartPanel"),
  cartOverlay: document.getElementById("cartOverlay"),
  cartClose: document.getElementById("cartClose"),
  cartItems: document.getElementById("cartItems"),
  cartTotalCartons: document.getElementById("cartTotalCartons"),
  cartTotalPieces: document.getElementById("cartTotalPieces"),
  cartTotalPrice: document.getElementById("cartTotalPrice"),
  checkoutBtn: document.getElementById("checkoutBtn"),

  lightbox: document.getElementById("lightbox"),
  lightboxImg: document.getElementById("lightboxImg"),
  lightboxClose: document.getElementById("lightboxClose"),
  lightboxPrev: document.getElementById("lightboxPrev"),
  lightboxNext: document.getElementById("lightboxNext"),
  lightboxCounter: document.getElementById("lightboxCounter"),

  toastContainer: document.getElementById("toastContainer"),

  cartTotalItems: document.getElementById("cartTotalItems"),
  invoiceBtn: document.getElementById("invoiceBtn"),
  clearCartBtn: document.getElementById("clearCartBtn"),
  customerName: document.getElementById("customerName"),
  customerPhone: document.getElementById("customerPhone"),
  customerPhoneHint: document.getElementById("customerPhoneHint"),

  invoiceModal: document.getElementById("invoiceModal"),
  invoiceDoc: document.getElementById("invoiceDoc"),
  invoicePdfBtn: document.getElementById("invoicePdfBtn"),
  invoiceWhatsappBtn: document.getElementById("invoiceWhatsappBtn"),
  invoiceCloseBtn: document.getElementById("invoiceCloseBtn"),
};

attachImageFallback(el.lightboxImg);
// حالة تحميل الـ Lightbox: بتتشال عند نجاح أو فشل تحميل الصورة
el.lightboxImg.addEventListener("load", () => el.lightbox.classList.remove("is-loading"));
el.lightboxImg.addEventListener("error", () => el.lightbox.classList.remove("is-loading"));

/* =====================================================================
   إشعارات سريعة (Toast)
===================================================================== */
function showToast(message, type, duration) {
  if (!el.toastContainer) return;
  const toastType = type || "success";
  const toastDuration = typeof duration === "number" ? duration : 2600;

  const toast = document.createElement("div");
  toast.className = `toast ${toastType}`;

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = toastType === "error" ? "⚠️" : toastType === "hint" ? "💡" : "✓";

  const msg = document.createElement("span");
  msg.className = "toast-msg";
  msg.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(msg);
  el.toastContainer.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("show")));

  const remove = () => {
    toast.classList.remove("show");
    toast.classList.add("hide");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  };
  setTimeout(remove, toastDuration);
}

function maybeShowCartHintOnce() {
  let alreadyShown = false;
  try {
    alreadyShown = localStorage.getItem(CONFIG.cartHintStorageKey) === "1";
  } catch (e) {
    return;
  }
  if (alreadyShown) return;

  showToast("تقدر تفتح «طلبك» من الأعلى في أي وقت وتكمل الطلب عبر واتساب 👆", "hint", 4200);
  try {
    localStorage.setItem(CONFIG.cartHintStorageKey, "1");
  } catch (e) {
    /* تجاهل */
  }
}

/* =====================================================================
   حفظ السلة في LocalStorage
   نخزّن (id الظاهر + الوحدة + الكمية) فقط، ونعيد الربط بعد كل تحميل، لأن
   _key مبني على ترتيب الصف وممكن يتغير لو الشيت اتعدّل.
===================================================================== */
function saveCartToStorage() {
  try {
    const serializable = Object.keys(CART).map((key) => {
      const line = CART[key];
      return { id: line.id, unit: line.unit, qty: line.qty };
    });
    localStorage.setItem(CONFIG.cartStorageKey, JSON.stringify(serializable));
  } catch (e) {
    console.warn("[Cart] تعذّر حفظ السلة في LocalStorage:", e);
  }
}

function readRawCartFromStorage() {
  let raw;
  try {
    raw = localStorage.getItem(CONFIG.cartStorageKey);
  } catch (e) {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn("[Cart] بيانات سلة محفوظة تالفة — تم تجاهلها.");
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (l) =>
      l &&
      typeof l.id === "string" &&
      (l.unit === "piece" || l.unit === "carton") &&
      Number.isFinite(Number(l.qty))
  );
}

function reconcileCartWithProducts(rawLines) {
  const rebuilt = {};
  rawLines.forEach((line, idx) => {
    const qty = normalizeQuantity(line.qty);
    const match = PRODUCTS.find((p) => p.id === line.id);

    if (match && isUnitPurchasable(match, line.unit)) {
      const key = cartKey(match._key, line.unit);
      const existing = rebuilt[key];
      rebuilt[key] = {
        productKey: match._key,
        id: match.id,
        unit: line.unit,
        qty: existing ? normalizeQuantity(existing.qty + qty) : qty,
      };
    } else {
      const orphanKey = `orphan::${line.id}::${line.unit}::${idx}`;
      rebuilt[orphanKey] = { productKey: null, id: line.id, unit: line.unit, qty };
    }
  });
  CART = rebuilt;
}

/* =====================================================================
   2) تحميل البيانات + حالات الواجهة
===================================================================== */
function setViewState(state) {
  el.loadingState.hidden = true;
  el.loadErrorState.hidden = true;
  el.noProductsState.hidden = true;
  el.emptyState.hidden = true;
  el.grid.hidden = true;

  if (state === "loading") el.loadingState.hidden = false;
  else if (state === "error") el.loadErrorState.hidden = false;
  else if (state === "emptyData") el.noProductsState.hidden = false;
  else if (state === "ready") el.grid.hidden = false;
}

let PENDING_RAW_CART = [];

function init() {
  closeCartPanel();
  closeLightbox();

  PENDING_RAW_CART = readRawCartFromStorage();

  if (CONFIG.dataSource === "csv") {
    loadFromCsvFile(CONFIG.csvFilePath);
  } else if (CONFIG.dataSource === "sheet") {
    loadFromGoogleSheet(CONFIG.googleSheetCsvUrl);
  } else {
    processProducts(SAMPLE_PRODUCTS);
  }
}

// منع Race Condition: آخر طلب تحميل فقط هو اللي يحدّث الواجهة
let loadRequestToken = 0;

function loadFromCsvFile(path) {
  const token = ++loadRequestToken;
  setViewState("loading");
  Papa.parse(path, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (token !== loadRequestToken) return;
      if (results.errors && results.errors.length) {
        console.warn("[CSV] أخطاء أثناء تحليل الملف:", results.errors);
      }
      processProducts(results.data);
    },
    error: (err) => {
      if (token !== loadRequestToken) return;
      console.error("تعذّر تحميل ملف CSV:", err);
      setViewState("error");
    },
  });
}

function loadFromGoogleSheet(url) {
  if (!url) {
    console.warn("لم يتم تحديد رابط Google Sheet في CONFIG.googleSheetCsvUrl");
    setViewState("error");
    return;
  }
  const token = ++loadRequestToken;
  setViewState("loading");
  Papa.parse(url, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (token !== loadRequestToken) return;
      if (results.errors && results.errors.length) {
        console.warn("[Google Sheet] أخطاء أثناء تحليل البيانات:", results.errors);
      }
      processProducts(results.data);
    },
    error: (err) => {
      if (token !== loadRequestToken) return;
      console.error("تعذّر تحميل بيانات Google Sheet:", err);
      setViewState("error");
    },
  });
}

/**
 * تطبيع كل الصفوف وإسقاط غير الصالح فقط. كل صف صالح = منتج مستقل (حتى لو نفس الـ id تكرر)،
 * والسلة بتتعامل بالمفتاح الداخلي _key، واللي بيظهر للعميل ويتبعت في واتساب هو الكود الأصلي.
 */
function processProducts(rawList) {
  try {
    const rows = Array.isArray(rawList) ? rawList : [];
    const candidates = [];

    rows.forEach((row, i) => {
      if (!row) return;
      try {
        const normRow = normalizeRowKeys(row);
        const fields = extractFields(normRow);
        const product = normalizeProductRow(fields, i);
        if (product) candidates.push(product);
      } catch (rowErr) {
        // صف واحد تالف لا يكسر الكتالوج كله
        console.warn(`[Data] تم تجاهل الصف #${i + 1} بسبب خطأ غير متوقع:`, rowErr);
      }
    });

    PRODUCTS = candidates;
    PRODUCT_MAP = new Map(PRODUCTS.map((p) => [p._key, p]));

    reconcileCartWithProducts(PENDING_RAW_CART);
    PENDING_RAW_CART = [];

    buildCategoryMenu();

    if (PRODUCTS.length === 0) {
      setViewState("emptyData");
    } else {
      setViewState("ready");
      renderGrid();
    }
    renderCart();
  } catch (err) {
    console.error("خطأ غير متوقع أثناء معالجة بيانات المنتجات:", err);
    setViewState("error");
  }
}

/* =====================================================================
   3-ب) زرار "الفلاتر" — يظهر/يخفي صف الأقسام + الترتيب، عشان الهيدر
   ما ياخدش مساحة كبيرة من الشاشة أثناء التصفح (البحث لوحده يفضل ظاهر دايمًا)
===================================================================== */
function updateFiltersDot() {
  const active = ACTIVE_CATEGORY !== "الكل" || SORT_MODE !== "default";
  el.filtersToggleDot.hidden = !active;
}
function toggleFiltersRow() {
  const isOpen = el.filtersRow.hidden;
  el.filtersRow.hidden = !isOpen;
  el.filtersToggle.setAttribute("aria-expanded", String(isOpen));
  if (!isOpen) closeCategoryMenu();
}
el.filtersToggle.addEventListener("click", toggleFiltersRow);

/* =====================================================================
   3) القائمة المنسدلة للأقسام + الكيبورد
===================================================================== */
function buildCategoryMenu() {
  const counts = new Map();
  PRODUCTS.forEach((p) => counts.set(p.category, (counts.get(p.category) || 0) + 1));
  const categories = ["الكل", ...counts.keys()];

  el.categoryMenu.replaceChildren();
  categories.forEach((cat) => {
    const count = cat === "الكل" ? PRODUCTS.length : counts.get(cat) || 0;
    const isActive = cat === ACTIVE_CATEGORY;

    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    li.dataset.category = cat;
    li.className = isActive ? "active" : "";
    li.setAttribute("aria-selected", String(isActive));

    const nameSpan = document.createElement("span");
    nameSpan.textContent = cat;
    const countSpan = document.createElement("span");
    countSpan.className = "count";
    countSpan.textContent = String(count);
    li.appendChild(nameSpan);
    li.appendChild(countSpan);

    li.addEventListener("click", () => selectCategory(cat, li));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectCategory(cat, li);
      }
    });

    el.categoryMenu.appendChild(li);
  });
}

function selectCategory(cat, liEl) {
  ACTIVE_CATEGORY = cat;
  el.categoryLabel.textContent = cat === "الكل" ? "كل الأقسام" : cat;
  [...el.categoryMenu.children].forEach((c) => {
    c.classList.remove("active");
    c.setAttribute("aria-selected", "false");
  });
  if (liEl) {
    liEl.classList.add("active");
    liEl.setAttribute("aria-selected", "true");
  }
  closeCategoryMenu();
  el.categoryToggle.focus();
  updateFiltersDot();
  renderGrid();
}

function toggleCategoryMenu() {
  const isOpen = !el.categoryDropdown.classList.contains("open");
  el.categoryDropdown.classList.toggle("open", isOpen);
  el.categoryMenu.hidden = !isOpen;
  el.categoryToggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    const active = el.categoryMenu.querySelector("li.active") || el.categoryMenu.querySelector("li");
    if (active) active.focus();
  }
}
function closeCategoryMenu() {
  el.categoryDropdown.classList.remove("open");
  el.categoryMenu.hidden = true;
  el.categoryToggle.setAttribute("aria-expanded", "false");
}

el.categoryToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleCategoryMenu();
});
el.categoryToggle.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (el.categoryMenu.hidden) toggleCategoryMenu();
    else {
      const first = el.categoryMenu.querySelector("li");
      if (first) first.focus();
    }
  }
});
el.categoryMenu.addEventListener("keydown", (e) => {
  const items = [...el.categoryMenu.querySelectorAll("li")];
  if (!items.length) return;
  const idx = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    (items[(idx + 1 + items.length) % items.length] || items[0]).focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    (items[(idx - 1 + items.length) % items.length] || items[items.length - 1]).focus();
  } else if (e.key === "Home") {
    e.preventDefault();
    items[0].focus();
  } else if (e.key === "End") {
    e.preventDefault();
    items[items.length - 1].focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeCategoryMenu();
    el.categoryToggle.focus();
  }
});
document.addEventListener("click", (e) => {
  if (!el.categoryDropdown.contains(e.target)) closeCategoryMenu();
});

/* =====================================================================
   4) البحث الشامل + التصنيف + الترتيب + العرض
===================================================================== */

/** تطبيع نص عربي للمقارنة فقط (لا يغيّر بيانات المنتج الأصلية) */
function normalizeArabic(s) {
  return String(s || "")
    .replace(/[إأآا]/g, "ا")
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

let lastCrossCategoryNoticeTerm = null;

/** أولوية التطابق: كود مطابق 100 → كود يحتوي 80 → اسم مطابق 70 → اسم يحتوي 60 → قسم 40 → وصف 20 */
function searchRelevance(product, normTerm) {
  const nId = normalizeArabic(product.id);
  const nName = normalizeArabic(product.name);
  const nCat = normalizeArabic(product.category);
  const nDesc = normalizeArabic(product.description || "");

  if (nId === normTerm) return 100;
  if (nId.includes(normTerm)) return 80;
  if (nName === normTerm) return 70;
  if (nName.includes(normTerm)) return 60;
  if (nCat.includes(normTerm)) return 40;
  if (nDesc.includes(normTerm)) return 20;
  return 0;
}

/** بحث شامل في كل المنتجات بغض النظر عن القسم المختار */
function searchProducts(term) {
  const normTerm = normalizeArabic(term);
  if (!normTerm) return sortProducts(PRODUCTS.slice());

  const scored = [];
  PRODUCTS.forEach((p) => {
    const score = searchRelevance(p, normTerm);
    if (score > 0) scored.push({ p, score });
  });
  scored.sort((a, b) => b.score - a.score || a.p._order - b.p._order);
  return scored.map((s) => s.p);
}

function maybeShowCrossCategoryNotice(term, results) {
  if (!term || ACTIVE_CATEGORY === "الكل" || !results.length) return;
  if (lastCrossCategoryNoticeTerm === term) return;

  const foreignCats = new Set();
  results.forEach((p) => {
    if (p.category !== ACTIVE_CATEGORY) foreignCats.add(p.category);
  });
  if (!foreignCats.size) return;

  lastCrossCategoryNoticeTerm = term;
  const list = [...foreignCats];
  const msg =
    list.length === 1
      ? `🔎 النتائج ظهرت من قسم "${list[0]}" كمان`
      : `🔎 النتائج ظهرت من أقسام تانية كمان`;
  showToast(msg, "hint", 3200);
}

function getFilteredProducts() {
  const term = SEARCH_TERM.trim();
  if (term) return searchProducts(term);
  const list = ACTIVE_CATEGORY === "الكل" ? PRODUCTS : PRODUCTS.filter((p) => p.category === ACTIVE_CATEGORY);
  return sortProducts(list.slice());
}

function sortPriceValue(p) {
  if (typeof p.cartonPrice === "number") return p.cartonPrice;
  if (typeof p.piecePrice === "number" && p.pcsPerCarton) return p.piecePrice * p.pcsPerCarton;
  if (typeof p.piecePrice === "number") return p.piecePrice;
  return 0;
}
function sortProducts(list) {
  switch (SORT_MODE) {
    case "price-asc":
      return list.sort((a, b) => sortPriceValue(a) - sortPriceValue(b));
    case "price-desc":
      return list.sort((a, b) => sortPriceValue(b) - sortPriceValue(a));
    case "newest":
      return list.sort((a, b) => b._order - a._order);
    default:
      return list.sort((a, b) => a._order - b._order);
  }
}

function unitPrice(product, unit) {
  const p = unit === "piece" ? product.piecePrice : product.cartonPrice;
  return isNonNegativeFiniteNumber(p) ? p : null;
}
function unitLabel(unit) {
  return unit === "piece" ? "قطعة" : "كرتونة";
}

/**
 * القلب الحسابي لسطر واحد (منتج + كمية + وحدة). عدد الكراتين دايمًا صحيح (CEIL)،
 * وأي قيمة مكافئة غير معروفة بترجع null مش صفر.
 */
function computeLineTotals(product, qty, unit) {
  const price = unitPrice(product, unit);
  if (price === null) return null;

  const normQty = normalizeQuantity(qty);
  const hasCartonSize = isPositiveIntegerValue(product.pcsPerCarton);

  let pieces;
  let cartons;
  if (unit === "piece") {
    pieces = normQty;
    cartons = hasCartonSize ? Math.ceil(normQty / product.pcsPerCarton) : null;
  } else {
    cartons = normQty;
    pieces = hasCartonSize ? normQty * product.pcsPerCarton : null;
  }

  return { qty: normQty, unit, pieces, cartons, unitPrice: price, lineTotal: normQty * price };
}
function isUnitPurchasable(product, unit) {
  if (!product) return false;
  if (product.availability !== "available") return false;
  return unitPrice(product, unit) !== null;
}
function formatMoney(value) {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("en-US")} ${CONFIG.currency}`;
}

function buildGroupedByCategory(list) {
  const groups = new Map();
  list.forEach((p) => {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  });

  const fragment = document.createDocumentFragment();
  groups.forEach((items, cat) => {
    const section = document.createElement("section");
    section.className = "category-section";

    const heading = document.createElement("h2");
    heading.className = "category-heading";
    heading.appendChild(document.createTextNode(cat));
    const count = document.createElement("span");
    count.className = "category-heading-count";
    count.textContent = String(items.length);
    heading.appendChild(count);

    const grid = document.createElement("div");
    grid.className = "category-products-grid";
    items.forEach((p) => grid.appendChild(buildProductCard(p)));

    section.appendChild(heading);
    section.appendChild(grid);
    fragment.appendChild(section);
  });
  return fragment;
}

function renderGrid() {
  const term = SEARCH_TERM.trim();
  const list = getFilteredProducts();

  el.emptyState.hidden = list.length !== 0;
  el.grid.hidden = list.length === 0;
  if (list.length === 0) {
    el.grid.replaceChildren();
    return;
  }

  // "كل الأقسام" بدون بحث = مجمّعة بعناوين. غير كده = شبكة مسطحة.
  const grouped = !term && ACTIVE_CATEGORY === "الكل";
  el.grid.classList.toggle("grouped", grouped);

  if (grouped) {
    el.grid.replaceChildren(buildGroupedByCategory(list));
  } else {
    const fragment = document.createDocumentFragment();
    list.forEach((product) => fragment.appendChild(buildProductCard(product)));
    el.grid.replaceChildren(fragment);
  }

  maybeShowCrossCategoryNotice(term, list);
}

/** كارت منتج واحد (DOM آمن، بدون innerHTML لأي بيانات من الشيت) */
function buildProductCard(product) {
  const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
  const isAvailable = product.availability === "available";
  if (!isAvailable) node.classList.add("unavailable");

  const mediaEl = node.querySelector(".card-media");
  const img = node.querySelector(".card-img");
  attachImageFallback(img);

  const images = product.images && product.images.length ? product.images : [FALLBACK_IMAGE];
  let activeImageIndex = 0;

  const galleryNav = node.querySelector(".gallery-nav");
  const galleryPrev = node.querySelector(".gallery-arrow.prev");
  const galleryNext = node.querySelector(".gallery-arrow.next");
  const galleryCounter = node.querySelector(".gallery-counter");

  img.addEventListener("load", () => mediaEl.classList.remove("is-loading"));
  img.addEventListener("error", () => mediaEl.classList.remove("is-loading"));

  function renderActiveImage() {
    const src = images[activeImageIndex] || FALLBACK_IMAGE;
    delete img.dataset.fallbackApplied;
    if (src !== FALLBACK_IMAGE) mediaEl.classList.add("is-loading");
    img.src = src;
    img.alt =
      images.length > 1
        ? `${product.name} — صورة ${activeImageIndex + 1} من ${images.length}`
        : product.name;
    if (galleryCounter) galleryCounter.textContent = `${activeImageIndex + 1} / ${images.length}`;
  }

  function goToImage(newIndex) {
    activeImageIndex = (newIndex + images.length) % images.length;
    renderActiveImage();
  }

  if (images.length > 1) {
    if (galleryNav) galleryNav.hidden = false;
    if (galleryPrev) {
      galleryPrev.addEventListener("click", (e) => {
        e.stopPropagation();
        goToImage(activeImageIndex - 1);
      });
    }
    if (galleryNext) {
      galleryNext.addEventListener("click", (e) => {
        e.stopPropagation();
        goToImage(activeImageIndex + 1);
      });
    }
    let touchStartX = null;
    mediaEl.addEventListener("touchstart", (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    mediaEl.addEventListener(
      "touchend",
      (e) => {
        if (touchStartX === null) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 40) {
          // RTL: سحب لليمين = السابقة، سحب لليسار = التالية
          goToImage(dx < 0 ? activeImageIndex + 1 : activeImageIndex - 1);
        }
        touchStartX = null;
      },
      { passive: true }
    );
  }

  // إتاحة كاملة بالكيبورد: التركيز على الصورة، الأسهم للتنقل، Enter/Space للتكبير
  mediaEl.tabIndex = 0;
  mediaEl.setAttribute("role", "button");
  mediaEl.setAttribute("aria-label", `تكبير صور: ${product.name}`);
  mediaEl.addEventListener("keydown", (e) => {
    if (e.target !== mediaEl) return; // لا نتدخل في أزرار الأسهم الداخلية
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox(images, activeImageIndex, product.name, mediaEl);
    } else if (images.length > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      // RTL: السهم لليسار = التالية
      goToImage(e.key === "ArrowLeft" ? activeImageIndex + 1 : activeImageIndex - 1);
    }
  });

  renderActiveImage();

  const badgesEl = node.querySelector(".card-badges");
  if (badgesEl && product.badges && product.badges.length) {
    badgesEl.hidden = false;
    product.badges.forEach((text) => {
      const b = document.createElement("span");
      b.className = "card-badge";
      b.textContent = text;
      badgesEl.appendChild(b);
    });
  }

  mediaEl.addEventListener("click", () => openLightbox(images, activeImageIndex, product.name, mediaEl));

  node.querySelector(".qty-num").textContent = product.pcsPerCarton !== null ? String(product.pcsPerCarton) : "—";
  node.querySelector(".card-category").textContent = product.category;
  const itemIdEl = node.querySelector(".card-itemid");
  if (itemIdEl) itemIdEl.textContent = `كود: ${product.id}`;
  node.querySelector(".card-name").textContent = product.name;
  const descEl = node.querySelector(".card-desc");
  descEl.textContent = product.description;
  descEl.hidden = !product.description;

  const flag = node.querySelector(".avail-flag");
  if (isAvailable) {
    flag.textContent = "متوفر";
    flag.classList.add("in");
  } else {
    flag.textContent = "غير متوفر";
    flag.classList.add("out");
  }

  const unitButtons = [...node.querySelectorAll(".unit-btn")];
  const pieceBtn = unitButtons.find((b) => b.dataset.unit === "piece");
  const cartonBtn = unitButtons.find((b) => b.dataset.unit === "carton");
  const priceValue = node.querySelector(".price-value");
  const priceUnitLabel = node.querySelector(".price-unit-label");
  const lineTotalValue = node.querySelector(".line-total-value");
  const qtyInput = node.querySelector(".qty-input");
  const minusBtn = node.querySelector(".step-btn.minus");
  const plusBtn = node.querySelector(".step-btn.plus");
  const addBtn = node.querySelector(".btn-add");
  const waBtn = node.querySelector(".btn-whatsapp");

  qtyInput.max = String(CONFIG.maxQuantity);
  qtyInput.value = "1";

  const piecePurchasable = unitPrice(product, "piece") !== null;
  const cartonPurchasable = unitPrice(product, "carton") !== null;

  if (!piecePurchasable) {
    pieceBtn.disabled = true;
    pieceBtn.classList.add("disabled");
    pieceBtn.setAttribute("aria-disabled", "true");
    pieceBtn.title = "الصنف ده متاح بالكرتونة فقط";
  }
  if (!cartonPurchasable) {
    cartonBtn.disabled = true;
    cartonBtn.classList.add("disabled");
    cartonBtn.setAttribute("aria-disabled", "true");
    cartonBtn.title = "الصنف ده متاح بالقطعة فقط";
  }

  let selectedUnit =
    CONFIG.defaultUnit === "piece" && piecePurchasable
      ? "piece"
      : cartonPurchasable
      ? "carton"
      : piecePurchasable
      ? "piece"
      : "carton";

  function refreshCardUI() {
    unitButtons.forEach((b) => b.classList.toggle("active", b.dataset.unit === selectedUnit));
    const price = unitPrice(product, selectedUnit);
    priceValue.textContent = price !== null ? formatMoney(price) : "—";
    priceUnitLabel.textContent = selectedUnit === "piece" ? "للقطعة" : "للكرتونة";

    const totals = computeLineTotals(product, qtyInput.value, selectedUnit);
    if (!totals) {
      lineTotalValue.textContent = "غير متاح حالياً";
      return;
    }
    // بالقطعة: نعرض القطع فقط (بدون تحويل لكراتين). بالكرتونة: نوضّح المكافئ بالقطع.
    const equivalentText =
      selectedUnit === "carton" && totals.pieces !== null ? ` (${totals.pieces} قطعة)` : "";
    lineTotalValue.textContent = `${formatMoney(totals.lineTotal)} — ${totals.qty} ${unitLabel(
      selectedUnit
    )}${equivalentText}`;
  }

  unitButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      selectedUnit = btn.dataset.unit;
      refreshCardUI();
    });
  });

  minusBtn.addEventListener("click", () => {
    if (minusBtn.disabled) return;
    qtyInput.value = String(normalizeQuantity(Number(qtyInput.value) - 1));
    refreshCardUI();
  });
  plusBtn.addEventListener("click", () => {
    if (plusBtn.disabled) return;
    qtyInput.value = String(normalizeQuantity(Number(qtyInput.value) + 1));
    refreshCardUI();
  });
  qtyInput.addEventListener("input", refreshCardUI);
  qtyInput.addEventListener("change", () => {
    qtyInput.value = String(normalizeQuantity(qtyInput.value));
    refreshCardUI();
  });

  let feedbackTimer = null;
  const addBtnOriginalText = addBtn.textContent;
  addBtn.addEventListener("click", () => {
    if (addBtn.disabled) return;
    if (!isUnitPurchasable(product, selectedUnit)) return;
    const qty = normalizeQuantity(qtyInput.value);
    qtyInput.value = String(qty);
    addToCart(product, qty, selectedUnit);

    addBtn.textContent = "تمت الإضافة ✓";
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      addBtn.textContent = addBtnOriginalText;
    }, 1200);
  });

  waBtn.addEventListener("click", () => {
    if (waBtn.disabled) return;
    if (!isUnitPurchasable(product, selectedUnit)) return;
    const qty = normalizeQuantity(qtyInput.value);
    qtyInput.value = String(qty);
    const link = buildSingleItemWhatsappLink(product, qty, selectedUnit);
    if (link) window.open(link, "_blank", "noopener");
  });

  if (!isAvailable) {
    [addBtn, waBtn, qtyInput, minusBtn, plusBtn, pieceBtn, cartonBtn].forEach((elx) => {
      elx.disabled = true;
      elx.setAttribute("aria-disabled", "true");
    });
  } else if (!piecePurchasable && !cartonPurchasable) {
    [addBtn, waBtn].forEach((elx) => {
      elx.disabled = true;
      elx.setAttribute("aria-disabled", "true");
    });
  }

  refreshCardUI();
  return node;
}

/* =====================================================================
   5) سلة الطلب
===================================================================== */
function cartKey(productKey, unit) {
  return `${productKey}::${unit}`;
}

function addToCart(product, qty, unit) {
  if (!isUnitPurchasable(product, unit)) return;

  const key = cartKey(product._key, unit);
  const existing = CART[key];
  const newQty = normalizeQuantity((existing ? existing.qty : 0) + qty);
  CART[key] = { productKey: product._key, id: product.id, unit, qty: newQty };
  renderCart();
  saveCartToStorage();

  showToast(`تمت إضافة "${product.name}" للسلة ✓`, "success");
  maybeShowCartHintOnce();
}

function removeFromCart(key) {
  delete CART[key];
  renderCart();
  saveCartToStorage();
}

function buildInvalidCartLine(key, titleText, metaText) {
  const row = document.createElement("div");
  row.className = "cart-line invalid";

  const info = document.createElement("div");
  info.className = "cart-line-info";
  const name = document.createElement("div");
  name.className = "name";
  name.textContent = titleText;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = metaText;
  info.appendChild(name);
  info.appendChild(meta);

  const removeBtn = document.createElement("button");
  removeBtn.className = "cart-line-remove";
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", "إزالة");
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => removeFromCart(key));

  row.appendChild(info);
  row.appendChild(removeBtn);
  return row;
}

function renderCart() {
  const keys = Object.keys(CART);
  el.cartItems.replaceChildren();

  if (keys.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.className = "cart-empty-msg";
    emptyMsg.textContent = "لسه ما ضفتش أي أصناف للطلب";
    el.cartItems.appendChild(emptyMsg);
  }

  let hasInvalid = false;
  let invalidLines = 0;

  keys.forEach((key) => {
    const line = CART[key];
    const qty = normalizeQuantity(line.qty);

    const product = line.productKey ? PRODUCT_MAP.get(line.productKey) : null;
    if (!product) {
      hasInvalid = true;
      invalidLines += 1;
      el.cartItems.appendChild(buildInvalidCartLine(key, "هذا الصنف لم يعد متاحاً", `كود: ${line.id}`));
      return;
    }

    if (!isUnitPurchasable(product, line.unit)) {
      hasInvalid = true;
      invalidLines += 1;
      const reason =
        product.availability !== "available"
          ? "هذا الصنف غير متوفر حالياً — برجاء إزالته"
          : "السعر غير متاح حالياً لهذا الصنف — برجاء إزالته";
      el.cartItems.appendChild(buildInvalidCartLine(key, product.name, reason));
      return;
    }

    const totals = computeLineTotals(product, qty, line.unit);
    if (!totals) {
      hasInvalid = true;
      invalidLines += 1;
      el.cartItems.appendChild(
        buildInvalidCartLine(key, product.name, "السعر غير متاح حالياً لهذا الصنف — برجاء إزالته")
      );
      return;
    }

    const row = document.createElement("div");
    row.className = "cart-line";

    const img = document.createElement("img");
    img.src = resolveImageSrc(product);
    img.alt = product.name;
    img.loading = "lazy";
    img.decoding = "async";
    attachImageFallback(img);

    const info = document.createElement("div");
    info.className = "cart-line-info";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = product.name;

    const codeLine = document.createElement("div");
    codeLine.className = "meta";
    codeLine.textContent = `كود: ${product.id}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${totals.qty} ${unitLabel(line.unit)} × ${formatMoney(totals.unitPrice)} = ${formatMoney(
      totals.lineTotal
    )}`;

    const badge = document.createElement("span");
    badge.className = "unit-badge" + (line.unit === "piece" ? " piece" : "");
    if (line.unit === "piece") {
      badge.textContent = "شراء بالقطعة";
    } else {
      badge.textContent =
        totals.pieces !== null ? `شراء بالكرتونة (${totals.pieces} قطعة)` : "شراء بالكرتونة";
    }

    info.appendChild(name);
    info.appendChild(codeLine);
    info.appendChild(meta);
    info.appendChild(badge);

    const removeBtn = document.createElement("button");
    removeBtn.className = "cart-line-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "إزالة");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => removeFromCart(key));

    row.appendChild(img);
    row.appendChild(info);
    row.appendChild(removeBtn);
    el.cartItems.appendChild(row);
  });

  // الإجماليات كلها من Order Model الموحّد (نفس مصدر الفاتورة والواتساب)
  const order = computeOrder();
  // عدّاد الهيدر = عدد الأصناف (مش جمع كراتين وقطع في رقم واحد)
  el.cartCount.textContent = String(order.totals.items + invalidLines);
  el.cartTotalItems.textContent = String(order.totals.items);
  el.cartTotalCartons.textContent = String(order.totals.cartons);
  el.cartTotalPieces.textContent = String(order.totals.pieces);
  el.cartTotalPrice.textContent = formatMoney(order.totals.grand);

  const blocked = keys.length === 0 || hasInvalid || order.hasInvalid;
  const blockedTitle = hasInvalid ? "برجاء إزالة الأصناف غير المتاحة من السلة أولاً" : "";
  el.checkoutBtn.disabled = blocked;
  el.checkoutBtn.title = blockedTitle;
  el.invoiceBtn.disabled = blocked;
  el.invoiceBtn.title = blockedTitle;
  el.clearCartBtn.disabled = keys.length === 0;
  if (keys.length === 0) {
    CURRENT_ORDER_META = null;
    resetClearCartButton();
  }
}

function trapCartFocus(e) {
  if (e.key !== "Tab") return;
  const focusables = el.cartPanel.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const list = Array.prototype.slice.call(focusables);
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openCartPanel() {
  el.cartPanel.classList.add("open");
  el.cartPanel.setAttribute("aria-hidden", "false");
  el.cartOverlay.hidden = false;
  requestAnimationFrame(() => {
    el.cartOverlay.classList.add("show");
    el.cartClose.focus();
  });
  document.addEventListener("keydown", trapCartFocus);
}
function closeCartPanel() {
  const wasOpen = el.cartPanel.classList.contains("open");
  el.cartPanel.classList.remove("open");
  el.cartPanel.setAttribute("aria-hidden", "true");
  el.cartOverlay.classList.remove("show");
  el.cartOverlay.hidden = true;
  document.removeEventListener("keydown", trapCartFocus);
  if (wasOpen) el.cartBtn.focus();
}

/* =====================================================================
   6) نموذج الطلب الموحّد (Order Model) — مصدر واحد للسلة والفاتورة والواتساب
   (الواتساب للمنتج الواحد بقى بيمر من هنا كمان)
===================================================================== */
const WHATSAPP_MAX_CHARS = 3500; // حد أمان لطول الرسالة (لم يُقَس فعليًا على كل الأجهزة)
const ORDER_SEQ_KEY = "aliraqi_order_seq_v1";
let CURRENT_ORDER_META = null;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** نص مختصر بيرافق صورة الفاتورة على واتساب (مش تكرار للتفاصيل، هي موجودة في الصورة نفسها) */
function buildInvoiceCaption(order, meta, customer) {
  const L = [];
  L.push(`*${CONFIG.storeName}*`);
  L.push(`طلب رقم: ${meta.number}`);
  if (customer.name) L.push(`العميل: ${customer.name}`);
  L.push(`عدد الأصناف: ${order.totals.items} — الإجمالي: ${formatMoney(order.totals.grand)}`);
  L.push("");
  L.push("📎 صورة الفاتورة كاملة مرفقة في الرسالة دي — لو مش شايفها، ابحث عن آخر صورة حمّلتها دلوقتي وارفقها هنا.");
  return L.join("\n");
}

function isValidWhatsappNumber(num) {
  return typeof num === "string" && /^\d{8,15}$/.test(num.trim());
}

/**
 * يبني الطلب من قائمة مدخلات [{ productKey, unit, qty }]. نفس المنتج بالكرتونة + بالقطعة = سطر واحد.
 * بيتستخدم للسلة كاملة (computeOrder) وللمنتج الواحد في واتساب.
 */
function computeOrderFromEntries(entries) {
  const groups = new Map();
  let hasInvalid = false;

  entries.forEach((entry) => {
    const product = entry.productKey ? PRODUCT_MAP.get(entry.productKey) : null;
    if (!product || !isUnitPurchasable(product, entry.unit)) {
      hasInvalid = true;
      return;
    }
    const t = computeLineTotals(product, entry.qty, entry.unit);
    if (!t) {
      hasInvalid = true;
      return;
    }
    let line = groups.get(product._key);
    if (!line) {
      line = {
        product,
        cartons: 0,
        pieces: 0,
        cartonPrice: unitPrice(product, "carton"),
        piecePrice: unitPrice(product, "piece"),
        cartonTotal: 0,
        pieceTotal: 0,
        lineTotal: 0,
      };
      groups.set(product._key, line);
    }
    if (entry.unit === "carton") {
      line.cartons += t.qty;
      line.cartonTotal = round2(line.cartonTotal + t.lineTotal);
    } else {
      line.pieces += t.qty;
      line.pieceTotal = round2(line.pieceTotal + t.lineTotal);
    }
    line.lineTotal = round2(line.cartonTotal + line.pieceTotal);
  });

  const lines = [...groups.values()].sort((a, b) => a.product._order - b.product._order);
  const totals = { items: lines.length, cartons: 0, pieces: 0, grand: 0 };
  lines.forEach((l) => {
    totals.cartons += l.cartons;
    totals.pieces += l.pieces;
    totals.grand = round2(totals.grand + l.lineTotal);
  });
  return { lines, totals, hasInvalid };
}

function computeOrder() {
  return computeOrderFromEntries(Object.keys(CART).map((k) => CART[k]));
}

/* ---- رقم الطلب المحلي: ALR-YYYYMMDD-0001 (محلي على هذا المتصفح/الجهاز فقط) ---- */
function pad2(n) {
  return String(n).padStart(2, "0");
}
function todayStamp(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}
function formatOrderDate(d) {
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function issueOrderNumber(now) {
  const stamp = todayStamp(now);
  let seq = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_SEQ_KEY) || "null");
    if (saved && saved.date === stamp && Number.isInteger(saved.seq) && saved.seq >= 0) seq = saved.seq;
  } catch (e) {
    seq = 0;
  }
  seq += 1;
  try {
    localStorage.setItem(ORDER_SEQ_KEY, JSON.stringify({ date: stamp, seq }));
  } catch (e) {
    /* التخزين غير متاح */
  }
  return `ALR-${stamp}-${String(seq).padStart(4, "0")}`;
}
function ensureOrderMeta(order) {
  const fingerprint = order.lines.map((l) => `${l.product._key}:${l.cartons}:${l.pieces}`).join("|");
  if (!CURRENT_ORDER_META || CURRENT_ORDER_META.fingerprint !== fingerprint) {
    const now = new Date();
    CURRENT_ORDER_META = { number: issueOrderNumber(now), fingerprint, date: now };
  }
  return CURRENT_ORDER_META;
}

/* ---- بيانات العميل الاختيارية (في الذاكرة فقط، لا تُخزَّن) ---- */
function normalizeEgyptPhone(raw) {
  const s = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!s) return { empty: true, valid: false, e164: "", display: "" };
  let d = s.replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 1632)).replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 11) d = "20" + d.slice(1);
  else if (d.length === 10 && d.startsWith("1")) d = "20" + d;
  const valid = /^201[0125]\d{8}$/.test(d);
  if (!valid) return { empty: false, valid: false, e164: "", display: "" };
  return {
    empty: false,
    valid: true,
    e164: d,
    display: `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8)}`,
  };
}

function getCustomerInfo() {
  const name = String(el.customerName.value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return { name, phone: normalizeEgyptPhone(el.customerPhone.value) };
}

function updatePhoneHint() {
  const p = normalizeEgyptPhone(el.customerPhone.value);
  const bad = !p.empty && !p.valid;
  el.customerPhoneHint.hidden = !bad;
  el.customerPhoneHint.textContent = bad ? "الرقم غير مفهوم — مش هيتضاف للطلب. مثال: 01012345678" : "";
}

/* ---- رسالة الواتساب من نفس نموذج الطلب ---- */
function buildOrderWhatsappMessage(order, meta, customer, compact) {
  const L = [];
  L.push(`*${CONFIG.storeName}*`);
  L.push(`طلب رقم: ${meta.number}`);
  L.push(`التاريخ: ${formatOrderDate(meta.date)}`);
  if (customer.name) L.push(`العميل: ${customer.name}`);
  if (customer.phone.valid) L.push(`الهاتف: +${customer.phone.e164}`);
  L.push("");

  order.lines.forEach((l, i) => {
    if (compact) {
      // سطر واحد لكل صنف: الاسم (الكود) — الكمية = الإجمالي
      const parts = [];
      if (l.cartons > 0) parts.push(`${l.cartons} كرتونة`);
      if (l.pieces > 0) parts.push(`${l.pieces} قطعة`);
      L.push(`${i + 1}. ${l.product.name} (${l.product.id}) — ${parts.join(" + ")} = ${formatMoney(l.lineTotal)}`);
      return;
    }
    L.push(`${i + 1}. ${l.product.name}`);
    L.push(`   الكود: ${l.product.id}`);
    if (l.cartons > 0) {
      const size = l.product.pcsPerCarton ? ` (${l.product.pcsPerCarton} قطعة/كرتونة)` : "";
      L.push(`   الكراتين: ${l.cartons}${size} × ${formatMoney(l.cartonPrice)} = ${formatMoney(l.cartonTotal)}`);
    }
    if (l.pieces > 0) {
      L.push(`   القطع: ${l.pieces} × ${formatMoney(l.piecePrice)} = ${formatMoney(l.pieceTotal)}`);
    }
    if (l.cartons > 0 && l.pieces > 0) L.push(`   إجمالي الصنف: ${formatMoney(l.lineTotal)}`);
  });

  L.push("");
  L.push(`عدد الأصناف: ${order.totals.items}`);
  L.push(`إجمالي الكراتين: ${order.totals.cartons}`);
  L.push(`إجمالي القطع: ${order.totals.pieces}`);
  L.push(`الإجمالي النهائي: ${formatMoney(order.totals.grand)}`);
  return L.join("\n");
}

/** يبني نص واتساب: التفصيلي أولاً، ولو طويل جدًا ينتقل تلقائيًا للمضغوط (نفس الأرقام بالظبط) */
function buildWhatsappText(order, meta, customer) {
  const full = buildOrderWhatsappMessage(order, meta, customer, false);
  if (full.length <= WHATSAPP_MAX_CHARS) return { text: full, compact: false };
  return { text: buildOrderWhatsappMessage(order, meta, customer, true), compact: true };
}

function buildSingleItemWhatsappLink(product, qty, unit) {
  if (!isValidWhatsappNumber(CONFIG.whatsappNumber)) {
    console.error("رقم واتساب غير صالح في الإعدادات (CONFIG.whatsappNumber).");
    return null;
  }
  const order = computeOrderFromEntries([{ productKey: product._key, unit, qty }]);
  if (!order.lines.length || order.hasInvalid) return null;

  const now = new Date();
  const meta = { number: issueOrderNumber(now), date: now };
  const built = buildWhatsappText(order, meta, getCustomerInfo());
  return `https://wa.me/${CONFIG.whatsappNumber.trim()}?text=${encodeURIComponent(built.text)}`;
}

/**
 * الزرار السريع في سلة "طلبك": بيفتح معاينة الفاتورة (عشان تتظبط بيانات العميل
 * لو حابب تكتبها) وبعدها على طول بيبدأ نفس مسار "إرسال كصورة عبر واتساب" —
 * تنفيذًا لقاعدة: الطلب ميتبعتش عبر واتساب إلا كصورة فاتورة، أبدًا كنص.
 */
function quickSendOrderAsImage() {
  const order = computeOrder();
  if (!order.lines.length || order.hasInvalid) return;
  openInvoice();
  sendInvoiceImageToWhatsapp();
}

/* ---- تفريغ السلة (ضغطتين للتأكيد) ---- */
let clearConfirmTimer = null;
function resetClearCartButton() {
  clearTimeout(clearConfirmTimer);
  el.clearCartBtn.classList.remove("confirm");
  el.clearCartBtn.textContent = "تفريغ السلة";
}
function handleClearCart() {
  if (el.clearCartBtn.disabled) return;
  if (!el.clearCartBtn.classList.contains("confirm")) {
    el.clearCartBtn.classList.add("confirm");
    el.clearCartBtn.textContent = "اضغط مرة تانية للتأكيد";
    clearTimeout(clearConfirmTimer);
    clearConfirmTimer = setTimeout(resetClearCartButton, 3000);
    return;
  }
  CART = {};
  CURRENT_ORDER_META = null;
  resetClearCartButton();
  renderCart();
  saveCartToStorage();
}

/* =====================================================================
   6-ج) الفاتورة / بيان الطلب
===================================================================== */
function invCell(tag, text, cls) {
  const c = document.createElement(tag);
  if (cls) c.className = cls;
  c.textContent = text;
  return c;
}

function renderInvoice(order, meta, customer) {
  const doc = el.invoiceDoc;
  doc.replaceChildren();

  const head = document.createElement("div");
  head.className = "inv-head";

  const brand = document.createElement("div");
  brand.className = "inv-brand";
  brand.appendChild(invCell("b", "AL-IRAQI"));
  brand.appendChild(invCell("small", "HOME APPLIANCES"));
  brand.appendChild(invCell("span", "العراقي للاستيراد وتجارة الأدوات المنزلية"));

  const metaBox = document.createElement("div");
  metaBox.className = "inv-meta";
  const addMeta = (label, value) => {
    const row = document.createElement("div");
    row.appendChild(invCell("span", label));
    row.appendChild(invCell("b", value));
    metaBox.appendChild(row);
  };
  addMeta("رقم الطلب", meta.number);
  addMeta("التاريخ", formatOrderDate(meta.date));
  if (customer.name) addMeta("العميل", customer.name);
  if (customer.phone.valid) addMeta("الهاتف", customer.phone.display);

  head.appendChild(brand);
  head.appendChild(metaBox);
  doc.appendChild(head);

  const showCartons = order.totals.cartons > 0;
  const showPieces = order.totals.pieces > 0;

  const table = document.createElement("table");
  table.className = "inv-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  ["الصورة", "الصنف", "الكود"].forEach((h) => hr.appendChild(invCell("th", h)));
  if (showCartons) hr.appendChild(invCell("th", "كراتين"));
  if (showPieces) hr.appendChild(invCell("th", "قطع"));
  hr.appendChild(invCell("th", "قطع/كرتونة"));
  if (showCartons) hr.appendChild(invCell("th", "سعر الكرتونة"));
  if (showPieces) hr.appendChild(invCell("th", "سعر القطعة"));
  hr.appendChild(invCell("th", "الإجمالي"));
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  order.lines.forEach((l) => {
    const tr = document.createElement("tr");

    const imgTd = document.createElement("td");
    const img = document.createElement("img");
    img.className = "inv-thumb";
    img.alt = "";
    // eager عمدًا: صور الفاتورة لازم تكون اتحمّلت قبل التصدير (lazy كانت بتطلع فاضية)
    img.loading = "eager";
    img.decoding = "async";
    // crossOrigin: لازم عشان html2canvas يقدر يقرأ بكسلات الصورة ويحولها لـ PDF/صورة
    // (الصور بتيجي من i.ibb.co وبيرسل Access-Control-Allow-Origin: * فالمفروض تشتغل عادي)
    img.crossOrigin = "anonymous";
    attachImageFallback(img);
    img.src = resolveImageSrc(l.product);
    imgTd.appendChild(img);
    tr.appendChild(imgTd);

    const nameTd = invCell("td", l.product.name, "inv-name");
    const typeLabel =
      l.cartons > 0 && l.pieces > 0 ? "كراتين + قطع" : l.cartons > 0 ? "كراتين فقط" : "قطع فقط";
    nameTd.appendChild(document.createElement("br"));
    nameTd.appendChild(invCell("span", typeLabel, "inv-type"));
    tr.appendChild(nameTd);

    tr.appendChild(invCell("td", l.product.id, "inv-code"));
    if (showCartons) tr.appendChild(invCell("td", l.cartons > 0 ? String(l.cartons) : "—"));
    if (showPieces) tr.appendChild(invCell("td", l.pieces > 0 ? String(l.pieces) : "—"));
    tr.appendChild(invCell("td", l.product.pcsPerCarton ? String(l.product.pcsPerCarton) : "—"));
    if (showCartons) tr.appendChild(invCell("td", l.cartons > 0 ? formatMoney(l.cartonPrice) : "—"));
    if (showPieces) tr.appendChild(invCell("td", l.pieces > 0 ? formatMoney(l.piecePrice) : "—"));
    tr.appendChild(invCell("td", formatMoney(l.lineTotal), "inv-total"));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const wrap = document.createElement("div");
  wrap.className = "inv-table-wrap";
  wrap.appendChild(table);
  doc.appendChild(wrap);

  const summary = document.createElement("div");
  summary.className = "inv-summary";
  const addSum = (label, value) => {
    const row = document.createElement("div");
    row.appendChild(invCell("span", label));
    row.appendChild(invCell("b", value));
    summary.appendChild(row);
  };
  addSum("إجمالي الأصناف", String(order.totals.items));
  addSum("إجمالي الكراتين", String(order.totals.cartons));
  addSum("إجمالي القطع", String(order.totals.pieces));
  addSum("الإجمالي النهائي", formatMoney(order.totals.grand));
  doc.appendChild(summary);

  doc.appendChild(
    invCell(
      "p",
      "بيان طلب مبدئي — الأسعار والتوفر خاضعة لتأكيد المتجر. رقم الطلب محلي على هذا المتصفح/الجهاز فقط وليس رقمًا مركزيًا.",
      "inv-note"
    )
  );
}

/* بيانات الفاتورة المفتوحة حاليًا (order + meta) — عشان نقدر نعيد رسمها لما العميل
   يكتب اسمه أو رقمه، من غير ما نعيد حساب رقم الطلب أو الإجماليات من الأول */
let INVOICE_STATE = null;

let invoiceTrigger = null;
function openInvoice() {
  const order = computeOrder();
  if (!order.lines.length || order.hasInvalid) return;
  const meta = ensureOrderMeta(order);
  INVOICE_STATE = { order, meta };
  renderInvoice(order, meta, getCustomerInfo());
  invoiceTrigger = document.activeElement;
  el.invoiceModal.hidden = false;
  el.invoiceModal.scrollTop = 0;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => el.customerName.focus());
}
function closeInvoice() {
  if (el.invoiceModal.hidden) return;
  el.invoiceModal.hidden = true;
  document.body.classList.remove("modal-open");
  INVOICE_STATE = null;
  if (invoiceTrigger && typeof invoiceTrigger.focus === "function") invoiceTrigger.focus();
  invoiceTrigger = null;
}
function trapInvoiceFocus(e) {
  if (e.key !== "Tab" || el.invoiceModal.hidden) return;
  const list = [el.customerName, el.customerPhone, el.invoicePdfBtn, el.invoiceWhatsappBtn, el.invoiceCloseBtn];
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** لما العميل يكتب اسمه/رقمه وهو فاتح معاينة الفاتورة، نعيد رسم الفاتورة بنفس order/meta فورًا */
function refreshInvoiceCustomerFields() {
  if (el.invoiceModal.hidden || !INVOICE_STATE) return;
  renderInvoice(INVOICE_STATE.order, INVOICE_STATE.meta, getCustomerInfo());
}

/**
 * يحوّل عنصر الفاتورة لـ canvas حقيقي عبر html2canvas، تمهيدًا لتصديرها PDF أو صورة.
 * ------------------------------------------------------------------
 * ⚠️ مهم: بنرسم دايمًا من نسخة (clone) بعرض ثابت (900px، زي شكلها على الديسكتوب)
 * موضوعة برّه الشاشة (مش من العنصر الظاهر فعليًا في المودال). ده مقصود ومش تفصيلة:
 * لو رسمنا من العنصر الظاهر في المودال على الموبايل، الصورة/الـ PDF الناتج كان
 * بيتقطع بحسب عرض شاشة العميل ومكان الـ scroll بتاعه وقت الضغط على الزرار،
 * وده كان سبب مشكلة "الفاتورة بتوصل ناقصة/مقطوعة". دلوقتي الناتج ثابت ومكتمل
 * دايمًا مهما كان جهاز العميل أو مكان تمريره في الصفحة وقت الإرسال.
 */
function renderInvoiceCanvas() {
  const FIXED_WIDTH_PX = 900;
  const clone = el.invoiceDoc.cloneNode(true);
  clone.style.position = "fixed";
  clone.style.top = "0";
  clone.style.left = "-99999px";
  clone.style.width = FIXED_WIDTH_PX + "px";
  clone.style.maxWidth = FIXED_WIDTH_PX + "px";
  clone.style.margin = "0";
  document.body.appendChild(clone);

  const cleanupAndRun = (target) =>
    html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      windowWidth: FIXED_WIDTH_PX,
      width: FIXED_WIDTH_PX,
    });

  return cleanupAndRun(clone)
    .catch((err) => {
      // فشل غالبًا بسبب قيد CORS على صور خارجية — نعيد المحاولة بنفس العرض الثابت بدون صور
      console.warn("[Invoice] تعذّر تضمين الصور (قيد CORS من مصدر الاستضافة) — إعادة المحاولة بدون صور:", err);
      clone.querySelectorAll("img").forEach((img) => img.remove());
      return cleanupAndRun(clone);
    })
    .finally(() => clone.remove());
}

/** يحوّل الفاتورة لملف PDF حقيقي (multi-page لو طويلة) وينزّله مباشرة — بدون أي نافذة طباعة */
async function downloadInvoicePdf() {
  if (!INVOICE_STATE) return;
  if (typeof html2canvas === "undefined" || !window.jspdf) {
    showToast("تعذّر تحميل مكتبة PDF — تحقق من الاتصال بالإنترنت وحاول تاني", "error", 4200);
    return;
  }
  const btn = el.invoicePdfBtn;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "جاري التجهيز…";
  try {
    const canvas = await renderInvoiceCanvas();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const pxPerMm = canvas.width / pageWidthMm;
    const pageHeightPx = Math.floor(pageHeightMm * pxPerMm);

    let renderedPx = 0;
    let firstPage = true;
    while (renderedPx < canvas.height) {
      const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeightPx;
      pageCanvas.getContext("2d").drawImage(canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);

      if (!firstPage) pdf.addPage();
      pdf.addImage(pageCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pageWidthMm, sliceHeightPx / pxPerMm);
      renderedPx += sliceHeightPx;
      firstPage = false;
    }
    pdf.save(`${INVOICE_STATE.meta.number}.pdf`);
  } catch (err) {
    console.error("[Invoice] تعذّر إنشاء ملف PDF:", err);
    showToast("تعذّر إنشاء ملف PDF — جرّب تاني", "error", 4200);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/**
 * يحوّل الفاتورة لصورة PNG وينزّلها على الجهاز، ثم يفتح واتساب برسالة نصية.
 * ⚠️ قيد حقيقي من واتساب نفسه: رابط wa.me مبيقدرش يرفق صورة تلقائيًا في الرسالة
 * (ده محتاج WhatsApp Business API مدفوعة + Backend، وده خارج نطاق المشروع).
 * فالحل المجاني المتاح: الصورة بتتنزّل على الجهاز، والعميل بيرفقها بنفسه في
 * محادثة واتساب اللي بتتفتح — خطوة واحدة بس (📎 في واتساب واختيار الصورة المُحمّلة).
 */
async function sendInvoiceImageToWhatsapp() {
  if (!INVOICE_STATE) return;
  if (!isValidWhatsappNumber(CONFIG.whatsappNumber)) {
    console.error("رقم واتساب غير صالح في الإعدادات (CONFIG.whatsappNumber).");
    return;
  }
  if (typeof html2canvas === "undefined") {
    showToast("تعذّر تحميل مكتبة الصورة — تحقق من الاتصال بالإنترنت", "error", 4200);
    return;
  }
  const btn = el.invoiceWhatsappBtn;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "جاري التجهيز…";
  try {
    const canvas = await renderInvoiceCanvas();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("canvas.toBlob رجّع فارغ");
    const objectUrl = URL.createObjectURL(blob);

    // target="_blank" مهم: على موبايل (خصوصًا Safari) الـ download attribute مش دايمًا
    // بيجبر تنزيل فعلي — فبنفتحها في تاب جديدة كمان كـ fallback، وهي صورة كاملة حقيقية
    // (PNG فعلي، مش مقطوعة) فالعميل يقدر يكبّرها/يمررها ويحفظها بنفسه من فوق لو حب.
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `${INVOICE_STATE.meta.number}.png`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);

    showToast("اتحمّلت صورة الفاتورة (كاملة) — هيفتح واتساب دلوقتي، أرفق الصورة يدويًا 📎", "hint", 5600);

    // نص مختصر بس (رقم الطلب + الإجمالي) لأن كل التفاصيل موجودة في صورة الفاتورة نفسها،
    // فمفيش داعي نكرر كل الأصناف كنص تاني، وده كمان بيمنع مشكلة تجاوز حد أحرف واتساب.
    const caption = buildInvoiceCaption(INVOICE_STATE.order, INVOICE_STATE.meta, getCustomerInfo());
    const link = `https://wa.me/${CONFIG.whatsappNumber.trim()}?text=${encodeURIComponent(caption)}`;
    setTimeout(() => window.open(link, "_blank", "noopener"), 500);
  } catch (err) {
    console.error("[Invoice] تعذّر إنشاء صورة الفاتورة:", err);
    showToast("تعذّر إنشاء صورة الفاتورة — جرّب تاني", "error", 4200);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* =====================================================================
   7) Lightbox — معرض كامل (سابق/تالي/عدّاد دايمًا/Swipe/Loading/Focus trap)
===================================================================== */
let LIGHTBOX_IMAGES = [];
let LIGHTBOX_INDEX = 0;

function renderLightboxImage() {
  const src = LIGHTBOX_IMAGES[LIGHTBOX_INDEX] || FALLBACK_IMAGE;
  delete el.lightboxImg.dataset.fallbackApplied;
  if (src !== FALLBACK_IMAGE) el.lightbox.classList.add("is-loading");
  el.lightboxImg.src = src;
  el.lightboxImg.alt =
    LIGHTBOX_IMAGES.length > 1 ? `صورة ${LIGHTBOX_INDEX + 1} من ${LIGHTBOX_IMAGES.length}` : "صورة المنتج";

  const multi = LIGHTBOX_IMAGES.length > 1;
  if (el.lightboxPrev) el.lightboxPrev.hidden = !multi;
  if (el.lightboxNext) el.lightboxNext.hidden = !multi;
  if (el.lightboxCounter) {
    el.lightboxCounter.hidden = false; // العدّاد يظهر دايمًا (1 / 1 لو صورة واحدة)
    el.lightboxCounter.textContent = `${LIGHTBOX_INDEX + 1} / ${LIGHTBOX_IMAGES.length}`;
  }
}

function goToLightboxImage(newIndex) {
  if (!LIGHTBOX_IMAGES.length) return;
  LIGHTBOX_INDEX = (newIndex + LIGHTBOX_IMAGES.length) % LIGHTBOX_IMAGES.length;
  renderLightboxImage();
}

function openLightbox(images, startIndex, caption, triggerEl) {
  lightboxTrigger = triggerEl || document.activeElement;
  LIGHTBOX_IMAGES = images && images.length ? images : [FALLBACK_IMAGE];
  LIGHTBOX_INDEX = typeof startIndex === "number" ? startIndex : 0;
  el.lightbox.setAttribute("aria-label", caption ? `تكبير صورة: ${caption}` : "تكبير صورة المنتج");
  renderLightboxImage();
  el.lightbox.hidden = false;
  requestAnimationFrame(() => el.lightboxClose.focus());
}
function closeLightbox() {
  const wasOpen = !el.lightbox.hidden;
  el.lightbox.hidden = true;
  el.lightbox.classList.remove("is-loading");
  if (wasOpen && lightboxTrigger && typeof lightboxTrigger.focus === "function") {
    lightboxTrigger.focus();
  }
  lightboxTrigger = null;
  LIGHTBOX_IMAGES = [];
  LIGHTBOX_INDEX = 0;
}

function trapLightboxFocus(e) {
  if (e.key !== "Tab" || el.lightbox.hidden) return;
  const list = [el.lightboxClose, el.lightboxPrev, el.lightboxNext].filter((b) => b && !b.hidden);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  if (!list.includes(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// Swipe على الموبايل داخل الـ Lightbox
let lightboxTouchX = null;
el.lightbox.addEventListener("touchstart", (e) => { lightboxTouchX = e.touches[0].clientX; }, { passive: true });
el.lightbox.addEventListener(
  "touchend",
  (e) => {
    if (lightboxTouchX === null || LIGHTBOX_IMAGES.length < 2) {
      lightboxTouchX = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - lightboxTouchX;
    if (Math.abs(dx) > 50) goToLightboxImage(dx < 0 ? LIGHTBOX_INDEX + 1 : LIGHTBOX_INDEX - 1);
    lightboxTouchX = null;
  },
  { passive: true }
);

/* =====================================================================
   8) ربط الأحداث
===================================================================== */
el.searchInput.addEventListener("input", (e) => {
  const value = e.target.value;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    SEARCH_TERM = value;
    renderGrid();
  }, 200);
});

el.sortSelect.addEventListener("change", (e) => {
  SORT_MODE = e.target.value;
  updateFiltersDot();
  renderGrid();
});

el.resetFilters.addEventListener("click", () => {
  SEARCH_TERM = "";
  ACTIVE_CATEGORY = "الكل";
  SORT_MODE = "default";
  el.searchInput.value = "";
  el.sortSelect.value = "default";
  el.categoryLabel.textContent = "كل الأقسام";
  buildCategoryMenu();
  updateFiltersDot();
  renderGrid();
});

if (el.retryLoadBtn) el.retryLoadBtn.addEventListener("click", () => init());

el.cartBtn.addEventListener("click", openCartPanel);
el.cartClose.addEventListener("click", closeCartPanel);
el.cartOverlay.addEventListener("click", closeCartPanel);
el.checkoutBtn.addEventListener("click", quickSendOrderAsImage);
el.invoiceBtn.addEventListener("click", openInvoice);
el.clearCartBtn.addEventListener("click", handleClearCart);
el.customerName.addEventListener("input", refreshInvoiceCustomerFields);
el.customerPhone.addEventListener("input", () => {
  updatePhoneHint();
  refreshInvoiceCustomerFields();
});

el.invoicePdfBtn.addEventListener("click", downloadInvoicePdf);
el.invoiceWhatsappBtn.addEventListener("click", sendInvoiceImageToWhatsapp);
el.invoiceCloseBtn.addEventListener("click", closeInvoice);
document.addEventListener("keydown", trapInvoiceFocus);
document.addEventListener("keydown", trapLightboxFocus);

el.lightboxClose.addEventListener("click", closeLightbox);
if (el.lightboxPrev) el.lightboxPrev.addEventListener("click", () => goToLightboxImage(LIGHTBOX_INDEX - 1));
if (el.lightboxNext) el.lightboxNext.addEventListener("click", () => goToLightboxImage(LIGHTBOX_INDEX + 1));
el.lightbox.addEventListener("click", (e) => {
  if (e.target === el.lightbox) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (!el.lightbox.hidden) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      // RTL: السهم لليسار = التالية
      goToLightboxImage(e.key === "ArrowLeft" ? LIGHTBOX_INDEX + 1 : LIGHTBOX_INDEX - 1);
    } else if (e.key === "Escape") {
      closeLightbox(); // ESC يقفل الأعلى فقط (الـ Lightbox)
    }
    return;
  }
  if (e.key !== "Escape") return;
  if (!el.invoiceModal.hidden) {
    closeInvoice();
    return;
  }
  if (el.cartPanel.classList.contains("open")) closeCartPanel();
  if (el.categoryDropdown.classList.contains("open")) {
    closeCategoryMenu();
    el.categoryToggle.focus();
  }
});

/* =====================================================================
   تشغيل الموقع
===================================================================== */
init();
