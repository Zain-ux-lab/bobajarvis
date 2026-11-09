// POST /api/square/ready — mark one Square SANDBOX order's fulfillment as PREPARED ("ready for pickup").
// Called by the app after the barista explicitly completes a ticket. Safe to retry:
// an order that is already PREPARED or later is left alone.

import { z } from "zod";
import { squareFetch } from "@/lib/server/square";

const Body = z.object({ squareOrderId: z.string().regex(/^[A-Za-z0-9_-]{10,64}$/) });
const ORDER = ["PROPOSED", "RESERVED", "PREPARED"] as const;

interface SqOrder {
  id: string;
  location_id: string;
  version: number;
  fulfillments?: { uid: string; state: string }[];
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad Square order id." }, { status: 400 });
  const id = parsed.data.squareOrderId;
  try {
    let { order } = await squareFetch<{ order: SqOrder }>(`/v2/orders/${id}`);
    const f = order.fulfillments?.[0];
    if (!f) return Response.json({ error: "That Square order has no fulfillment to mark ready." }, { status: 409 });
    if (["CANCELED", "FAILED"].includes(f.state)) return Response.json({ error: `Square order is ${f.state.toLowerCase()}; not marked ready.` }, { status: 409 });

    // Step one state at a time (PROPOSED -> RESERVED -> PREPARED). Already PREPARED/COMPLETED: nothing to do.
    let state = f.state;
    while (ORDER.indexOf(state as (typeof ORDER)[number]) >= 0 && state !== "PREPARED") {
      const nextState = ORDER[ORDER.indexOf(state as (typeof ORDER)[number]) + 1];
      ({ order } = await squareFetch<{ order: SqOrder }>(`/v2/orders/${id}`, {
        method: "PUT",
        body: {
          idempotency_key: `ready-${id}-${nextState}`, // same key on retry = no duplicate update
          order: { location_id: order.location_id, version: order.version, fulfillments: [{ uid: f.uid, state: nextState }] },
        },
      }));
      state = order.fulfillments?.find((x) => x.uid === f.uid)?.state ?? nextState;
    }
    return Response.json({ ok: true, state });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
