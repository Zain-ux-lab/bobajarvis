// Creates 3 fictional OPEN boba orders in your Square SANDBOX (no payment, no real money).
// Run: npm run square:seed   (reads SQUARE_ACCESS_TOKEN from .env.local)

const HOST = "https://connect.squareupsandbox.com"; // sandbox only, on purpose
const VERSION = "2026-09-16";
const token = process.env.SQUARE_ACCESS_TOKEN?.trim();
if (!token) {
  console.error("Missing SQUARE_ACCESS_TOKEN in .env.local (use the Sandbox access token).");
  process.exit(1);
}

async function sq(path, body) {
  const res = await fetch(HOST + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "square-version": VERSION, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json.errors ?? json).split(token).join("[redacted]")}`);
  return json;
}

const { locations } = await sq("/v2/locations");
const loc = locations.find((l) => l.id === process.env.SQUARE_LOCATION_ID) ?? locations.find((l) => l.status === "ACTIVE");
const money = (cents) => ({ amount: cents, currency: loc.currency ?? "USD" });
const mod = (name) => ({ name, base_price_money: money(0) });
const drink = (name, mods, qty = "1") => ({ name, quantity: qty, base_price_money: money(650), modifiers: mods.map(mod) });

// Order numbers change every few minutes so repeated runs don't reuse numbers.
const base = 200 + (Math.floor(Date.now() / 60000) % 70) * 10;
const orders = [
  ["Ava", [drink("Taro Milk Tea", ["Large", "50% sugar", "Less ice", "Tapioca pearls"])]],
  ["Ben", [drink("Matcha Latte", ["Regular", "70% sugar", "Regular ice", "Oat milk"]), drink("Mango Green Tea", ["Large", "100% sugar", "No ice", "Popping boba", "Aloe vera"])]],
  ["Chloe", [drink("Thai Milk Tea", ["Regular", "0% sugar", "Less ice", "Egg pudding"]), drink("Dragonfruit Slush", ["Large"])]], // one off-menu item on purpose
];

for (const [i, [name, line_items]] of orders.entries()) {
  const { order } = await sq("/v2/orders", {
    idempotency_key: crypto.randomUUID(),
    order: {
      location_id: loc.id,
      reference_id: String(base + i + 1),
      line_items,
      fulfillments: [{ type: "PICKUP", state: "PROPOSED", pickup_details: { recipient: { display_name: name }, schedule_type: "ASAP" } }],
    },
  });
  console.log(`Created order ${base + i + 1} for ${name} (Square id ${order.id}, state ${order.state})`);
}
console.log(`Location: ${loc.name}. Now click "Import open orders from Square sandbox" in the app's drawer.`);
