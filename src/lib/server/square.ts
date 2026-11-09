// Server-only Square calls. SANDBOX ONLY: the host is fixed so this can't touch a real shop.
// The token stays on the server and is redacted from every error message.

export const SQUARE_HOST = "https://connect.squareupsandbox.com";
export const SQUARE_VERSION = "2026-09-16"; // checked against Square's changelog on 2026-11-09

export function squareToken(): string | null {
  return process.env.SQUARE_ACCESS_TOKEN?.trim() || null;
}

export async function squareFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = squareToken();
  if (!token) throw new Error("No SQUARE_ACCESS_TOKEN in .env.local (use the Sandbox access token).");
  const res = await fetch(`${SQUARE_HOST}${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "square-version": SQUARE_VERSION, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { errors?: { code?: string; detail?: string }[] };
  if (!res.ok) {
    const detail = json.errors?.map((e) => `${e.code}: ${e.detail}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Square ${path} failed: ${detail.split(token).join("[redacted]")}`);
  }
  return json;
}

/** Use SQUARE_LOCATION_ID if set, else the account's first active location. */
export async function squareLocation(): Promise<{ id: string; currency: string; name: string }> {
  const { locations = [] } = await squareFetch<{ locations?: { id: string; status?: string; currency?: string; name?: string }[] }>("/v2/locations");
  const wanted = process.env.SQUARE_LOCATION_ID?.trim();
  const loc = wanted ? locations.find((l) => l.id === wanted) : locations.find((l) => l.status === "ACTIVE");
  if (!loc) throw new Error(wanted ? `Square location ${wanted} not found.` : "No active Square sandbox location.");
  return { id: loc.id, currency: loc.currency ?? "USD", name: loc.name ?? loc.id };
}
