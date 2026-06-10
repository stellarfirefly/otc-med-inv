const ALLOWED_ORIGINS = new Set([
  "https://stellarfirefly.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = getCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
    }

    const upc = normalizeLookupCode(new URL(request.url).searchParams.get("upc") || "");

    if (!upc) {
      return jsonResponse({ error: "UPC or EAN is required." }, 400, corsHeaders);
    }

    if (!isNumericLookupCode(upc)) {
      return jsonResponse({ error: "Online lookup only supports numeric UPC/EAN codes." }, 400, corsHeaders);
    }

    try {
      const upcItem = await lookupUpcItemDb(upc);
      if (upcItem) {
        return jsonResponse(upcItem, 200, corsHeaders);
      }

      const foodFacts = await lookupOpenFoodFacts(upc);
      if (foodFacts) {
        return jsonResponse(foodFacts, 200, corsHeaders);
      }

      return jsonResponse({ error: "No product details found for that UPC/EAN." }, 404, corsHeaders);
    } catch {
      return jsonResponse({ error: "Product lookup failed." }, 502, corsHeaders);
    }
  }
};

const getCorsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://stellarfirefly.github.io",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin"
});

const lookupUpcItemDb = async (upc) => {
  const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(upc)}`, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = await response.json();
  const item = payload.items?.[0];

  if (!item || payload.code !== "OK") {
    return undefined;
  }

  return toLookupResult({
    source: "UPCitemdb",
    upc,
    brand: item.brand,
    packageName: item.title || item.description,
    quantityText: [item.size, item.title, item.description].filter(Boolean).join(" ")
  });
};

const lookupOpenFoodFacts = async (upc) => {
  const fields = [
    "product_name",
    "generic_name",
    "brands",
    "quantity",
    "product_quantity",
    "product_quantity_unit"
  ].join(",");

  const response = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(upc)}.json?fields=${fields}`,
    {
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    return undefined;
  }

  const payload = await response.json();
  const product = payload.product;

  if (payload.status !== 1 || !product) {
    return undefined;
  }

  return toLookupResult({
    source: "Open Food Facts",
    upc,
    brand: firstCsvValue(product.brands),
    packageName: product.product_name || product.generic_name,
    quantityText: [
      product.quantity,
      product.product_quantity && product.product_quantity_unit
        ? `${product.product_quantity} ${product.product_quantity_unit}`
        : undefined,
      product.product_name,
      product.generic_name
    ]
      .filter(Boolean)
      .join(" ")
  });
};

const toLookupResult = ({
  source,
  upc,
  brand,
  packageName,
  quantityText
}) => {
  if (!packageName && !brand) {
    return undefined;
  }

  const quantity = inferPackageQuantity(quantityText || packageName || "");

  return {
    source,
    upc,
    brand: cleanText(brand) || "Unknown brand",
    packageName: cleanText(packageName) || cleanText(brand) || "Unknown product",
    packageQuantity: quantity.packageQuantity,
    unitLabel: quantity.unitLabel
  };
};

const inferPackageQuantity = (text) => {
  const normalized = text.toLowerCase();
  const countMatch = normalized.match(
    /\b(\d+(?:\.\d+)?)\s*(tablets?|tabs?|caplets?|capsules?|caps?|softgels?|gelcaps?|gummies?|lozenges?|packets?|patches?|count|ct)\b/
  );

  if (countMatch) {
    return {
      packageQuantity: Math.max(1, Math.round(Number(countMatch[1]))),
      unitLabel: normalizeUnitLabel(countMatch[2])
    };
  }

  const volumeMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|fluid ounces?|ounces?|oz|ml|milliliters?)\b/);
  if (volumeMatch) {
    return {
      packageQuantity: Number(volumeMatch[1]),
      unitLabel: normalizeUnitLabel(volumeMatch[2])
    };
  }

  return {
    packageQuantity: 1,
    unitLabel: "containers"
  };
};

const normalizeUnitLabel = (unit) => {
  const normalized = unit.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();

  if (["tablet", "tablets", "tab", "tabs"].includes(normalized)) return "tablets";
  if (["caplet", "caplets"].includes(normalized)) return "caplets";
  if (["capsule", "capsules", "cap", "caps"].includes(normalized)) return "capsules";
  if (["softgel", "softgels", "gelcap", "gelcaps"].includes(normalized)) return "softgels";
  if (["gummy", "gummies"].includes(normalized)) return "gummies";
  if (["lozenge", "lozenges"].includes(normalized)) return "lozenges";
  if (["packet", "packets"].includes(normalized)) return "packets";
  if (["patch", "patches"].includes(normalized)) return "patches";
  if (["count", "ct"].includes(normalized)) return "units";
  if (["fl oz", "fluid ounce", "fluid ounces"].includes(normalized)) return "fl oz";
  if (["ounce", "ounces", "oz"].includes(normalized)) return "oz";
  if (["ml", "milliliter", "milliliters"].includes(normalized)) return "mL";

  return normalized || "units";
};

const normalizeLookupCode = (value) => value.replace(/[^a-z0-9]/gi, "").toUpperCase().trim();

const isNumericLookupCode = (value) => /^\d+$/.test(value);

const cleanText = (value) => value?.replace(/\s+/g, " ").trim() ?? "";

const firstCsvValue = (value) => cleanText(value?.split(",")[0]);

const jsonResponse = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=86400" : "no-store"
    }
  });
