// GET /api/square — READ-ONLY import of open orders from the Square sandbox.
// Nothing is written to Square.

import { connection } from "next/server";
import { mapSquareOrder, type SquareOrder } from "@/lib/squareMap";
import { squareFetch, squareLocation, squareToken } from "@/lib/server/square";

export async function GET() {
  await connection();
  if (!squareToken()) return Response.json({ error: "No SQUARE_ACCESS_TOKEN in .env.local. Add your Square Sandbox access token and retry." }, { status: 503 });
  try {
    const loc = await squareLocation();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { orders = [] } = await squareFetch<{ orders?: SquareOrder[] }>("/v2/orders/search", {
      method: "POST",
      body: {
        location_ids: [loc.id],
        limit: 50,
        query: {
          filter: { state_filter: { states: ["OPEN"] }, date_time_filter: { created_at: { start_at: since } } },
          sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
        },
      },
    });
    const warnings: string[] = [];
    const tickets = [];
    let fallback = 900;
    for (const o of orders) {
      const m = mapSquareOrder(o, fallback++);
      warnings.push(...m.warnings);
      if (m.ticket) tickets.push(m.ticket);
    }
    return Response.json({ location: loc.name, squareOrders: orders.length, tickets, warnings });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
