"use client";
// The verification drawer: lets a reviewer SEE the simulated state the voice loop is changing.
// The barista never needs it.

import { useEffect, useRef, useState } from "react";
import type { Earpiece } from "@/lib/earpiece";
import { CATEGORIES, ITEMS, ITEM_BY_ID, LOW_STOCK_RATIO, MILK_IDS, TOPPING_IDS, formatQty } from "@/lib/inventory";
import { RECIPES, RECIPE_BY_ID, STAGES, stageInstruction, type Drink } from "@/lib/recipes";
import { drinkText } from "@/lib/shop";
import { useShop } from "@/lib/store";

const TABS = ["Tickets", "Inventory", "Recipes", "Test", "Action log"] as const;

/** Re-mount on change so the CSS flash replays; skip the very first render. */
function Flash({ value, children }: { value: unknown; children: React.ReactNode }) {
  const first = useRef(true);
  const [n, setN] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (prev.current !== value) {
      prev.current = value;
      setN((x) => x + 1);
    }
  }, [value]);
  return <span key={n} className={n ? "flash rounded px-1" : "px-1"}>{children}</span>;
}

export function Drawer({ onTyped, earpiece, rerender }: { onTyped: (t: string) => Promise<void>; earpiece: Earpiece; rerender: () => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Tickets");

  // Standard tab keyboard pattern: Left/Right arrows move between tabs.
  const onTabKey = (e: React.KeyboardEvent) => {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!move) return;
    const next = (TABS.indexOf(tab) + move + TABS.length) % TABS.length;
    setTab(TABS[next]);
    document.getElementById(`drawer-tab-${next}`)?.focus();
  };

  return (
    <div className={`border-edge bg-steep fixed inset-x-0 bottom-0 z-10 border-t transition-[height] duration-300 ${open ? "h-[70dvh]" : "h-14"}`}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="drawer-body" className="flex h-14 w-full items-center justify-between gap-3 px-4 text-left text-xs leading-tight -outline-offset-2 sm:text-sm">
        <span>Simulated POS & Boba Inventory — Demo Verification Only</span>
        <span className="text-husk shrink-0">{open ? "Close" : "Open"}</span>
      </button>
      {open && (
        <div id="drawer-body" className="flex h-[calc(70dvh-3.5rem)] flex-col">
          <div className="border-leaf flex gap-1 overflow-x-auto border-b px-3" role="tablist" aria-label="Simulated shop data" onKeyDown={onTabKey}>
            {TABS.map((t, i) => (
              <button key={t} id={`drawer-tab-${i}`} role="tab" aria-selected={tab === t} aria-controls="drawer-panel" tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)} className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-sm -outline-offset-2 ${tab === t ? "text-cream border-taro" : "text-husk border-transparent"}`}>
                {t}
              </button>
            ))}
          </div>
          <div id="drawer-panel" role="tabpanel" aria-labelledby={`drawer-tab-${TABS.indexOf(tab)}`} className="flex-1 overflow-y-auto px-4 py-3 text-sm">
            {tab === "Tickets" && <Tickets />}
            {tab === "Inventory" && <Inventory />}
            {tab === "Recipes" && <Recipes />}
            {tab === "Test" && <TestPanel onTyped={onTyped} earpiece={earpiece} rerender={rerender} />}
            {tab === "Action log" && <Log />}
          </div>
        </div>
      )}
    </div>
  );
}

function Tickets() {
  const shop = useShop((s) => s.shop);
  const syncSquareReady = useShop((s) => s.syncSquareReady);
  const sorted = [...shop.tickets].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <ul className="space-y-2">
      {sorted.map((t) => (
        <li key={t.id} className={`border-leaf rounded-lg border p-3 ${t.id === shop.activeOrderId ? "border-taro" : ""} ${t.status === "completed" ? "text-husk" : ""}`}>
          <p className="font-display">
            Order {t.id} for {t.customer} <Flash value={t.status}><span className={t.status === "completed" ? "text-matcha" : "text-amber"}>{t.status}</span></Flash>
            {t.id === shop.activeOrderId && <span className="text-taro"> active, drink {shop.activeDrinkIndex + 1}, {shop.currentRecipeStepIndex < 0 ? "not started" : `step ${shop.currentRecipeStepIndex + 1}`}</span>}
          </p>
          {t.squareOrderId && (
            <p className="text-husk text-xs">
              Square sandbox order{" "}
              {t.status === "completed" && (t.squareSync === "ready" ? <span className="text-matcha">marked ready for pickup in Square</span> : (
                <>
                  <span className="text-error">{t.squareSync ? `not updated: ${t.squareSync}` : "updating Square…"}</span>{" "}
                  <button onClick={() => void syncSquareReady(t.id)} className="underline">Retry</button>
                </>
              ))}
            </p>
          )}
          <ol className="text-husk mt-1 list-decimal pl-5">
            {t.drinks.map((d, i) => <li key={i}>{drinkText(d)}</li>)}
          </ol>
        </li>
      ))}
    </ul>
  );
}

function Inventory() {
  const shop = useShop((s) => s.shop);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {CATEGORIES.map((c) => (
        <section key={c}>
          <h3 className="font-display text-cream mb-1 capitalize">{c}</h3>
          <table className="w-full">
            <tbody>
              {ITEMS.filter((i) => i.category === c).map((i) => {
                const pct = shop.inventory[i.id] / i.capacity;
                return (
                  <tr key={i.id} className={pct < LOW_STOCK_RATIO ? "text-error" : ""}>
                    <td className="py-0.5">{i.name}</td>
                    <td className="text-right tabular-nums"><Flash value={shop.inventory[i.id]}>{formatQty(i.id, shop.inventory[i.id])}</Flash></td>
                    <td className="text-husk w-12 text-right tabular-nums">{Math.round(pct * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {c === "topping" && <p className="text-husk mt-1 text-xs">Tapioca batch cooked at {new Date(shop.tapiocaCookedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
        </section>
      ))}
    </div>
  );
}

function Recipes() {
  const [id, setId] = useState(RECIPES[0].id);
  const [size, setSize] = useState<Drink["size"]>("regular");
  const d: Drink = { recipeId: id, size, sugar: 100, ice: "regular", toppings: ["tapioca"] };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select value={id} onChange={(e) => setId(e.target.value)} className="bg-roast border-edge rounded border px-2 py-1">
          {RECIPES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value as Drink["size"])} className="bg-roast border-edge rounded border px-2 py-1">
          <option value="regular">Regular 500 ml</option>
          <option value="large">Large 700 ml</option>
        </select>
        <span className="text-husk self-center">shown at 100% sugar, regular ice, tapioca</span>
      </div>
      <ol className="space-y-1">
        {STAGES.map((_, i) => <li key={i}>{stageInstruction(d, i)}</li>)}
      </ol>
      <p className="text-husk">{RECIPE_BY_ID[id].kind === "fruit" ? "Fruit tea: no powder step." : "Milk tea."}</p>
    </div>
  );
}

function TestPanel({ onTyped, earpiece, rerender }: { onTyped: (t: string) => Promise<void>; earpiece: Earpiece; rerender: () => void }) {
  const { reset, addTicket, importSquareTickets } = useShop();
  const [squareMsg, setSquareMsg] = useState("");
  const importSquare = async () => {
    setSquareMsg("Importing from Square sandbox…");
    try {
      const r = await fetch("/api/square").then((x) => x.json());
      if (r.error) return setSquareMsg(r.error);
      const added = importSquareTickets(r.tickets);
      setSquareMsg([`${r.location}: ${r.squareOrders} open orders, ${added} new tickets imported.`, ...r.warnings].join(" "));
    } catch (e) {
      setSquareMsg(`Import failed: ${(e as Error).message}`);
    }
  };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [whisper, setWhisper] = useState("checking…");
  const [customer, setCustomer] = useState("Alex");
  const [drink, setDrink] = useState<Drink>({ recipeId: "taro_milk_tea", size: "regular", sugar: 50, ice: "less", toppings: ["tapioca"] });

  useEffect(() => {
    fetch("/api/transcribe").then((r) => r.json()).then((s) => setWhisper(s.modelFound ? `local ${s.engine} (${s.model})${s.engine === "whisper-cli" ? ", slower: start with npm run dev for whisper-server" : ""}` : `model missing: ${s.model}`)).catch(() => setWhisper("unavailable"));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await onTyped(text);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  const quick = ["What's the current order?", "Got it. What's next?", "Sugar?", "What comes after sugar?", "That order is done. What's the next order?", "How much milk do we have?", "What about oat?", "Restock those", "How many taro drinks are waiting?"];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-2">
        <h3 className="font-display">Typed phrase test</h3>
        <p className="text-husk">Uses exactly the same path as the microphone: /api/jarvis, then the executor.</p>
        <form onSubmit={submit} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type what the barista would say" aria-label="Phrase to test" className="bg-roast border-edge flex-1 rounded border px-3 py-2" />
          <button disabled={busy} className="bg-cream text-roast rounded px-4 py-2 disabled:opacity-50">{busy ? "Sending…" : "Send"}</button>
        </form>
        <div className="flex flex-wrap gap-1">
          {quick.map((q) => <button key={q} onClick={() => setText(q)} className="border-edge text-husk rounded-full border px-2.5 py-1 text-xs">{q}</button>)}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-display">Voice settings</h3>
        <p>Transcription: <span className="text-husk">{whisper}</span></p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={earpiece.pushToTalk} onChange={(e) => { earpiece.setPushToTalk(e.target.checked); rerender(); }} />
          Push-to-talk for noisy rooms (hold V or the Hold to talk button)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={earpiece.cues} onChange={(e) => { earpiece.setCues(e.target.checked); rerender(); }} />
          Audio cues (a chime when you&apos;re heard, a soft tick while thinking)
        </label>
        <button onClick={reset} className="border-error text-error rounded border px-3 py-1">Reset demo</button>
      </section>

      <section className="space-y-2 lg:col-span-2">
        <h3 className="font-display">Add a custom ticket</h3>
        <div className="flex flex-wrap gap-2">
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" className="bg-roast border-edge w-28 rounded border px-2 py-1" />
          <select value={drink.recipeId} onChange={(e) => setDrink({ ...drink, recipeId: e.target.value })} aria-label="Drink" className="bg-roast border-edge rounded border px-2 py-1">
            {RECIPES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={drink.size} onChange={(e) => setDrink({ ...drink, size: e.target.value as Drink["size"] })} aria-label="Size" className="bg-roast border-edge rounded border px-2 py-1">
            <option value="regular">Regular</option><option value="large">Large</option>
          </select>
          <select value={drink.sugar} onChange={(e) => setDrink({ ...drink, sugar: Number(e.target.value) as Drink["sugar"] })} aria-label="Sugar" className="bg-roast border-edge rounded border px-2 py-1">
            {[0, 50, 70, 100].map((s) => <option key={s} value={s}>{s}% sugar</option>)}
          </select>
          <select value={drink.ice} onChange={(e) => setDrink({ ...drink, ice: e.target.value as Drink["ice"] })} aria-label="Ice" className="bg-roast border-edge rounded border px-2 py-1">
            <option value="regular">Regular ice</option><option value="less">Less ice</option><option value="none">No ice</option>
          </select>
          <select value={drink.milk ?? ""} onChange={(e) => setDrink({ ...drink, milk: e.target.value || undefined })} aria-label="Milk" className="bg-roast border-edge rounded border px-2 py-1">
            <option value="">Recipe milk</option>
            {MILK_IDS.map((m) => <option key={m} value={m}>{ITEM_BY_ID[m].name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-3">
          {TOPPING_IDS.map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={drink.toppings.includes(t)} onChange={(e) => setDrink({ ...drink, toppings: e.target.checked ? [...drink.toppings, t] : drink.toppings.filter((x) => x !== t) })} />
              {ITEM_BY_ID[t].name}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => addTicket(customer || "Guest", [drink])} className="bg-cream text-roast rounded px-3 py-1">Add ticket</button>
          <button onClick={() => addTicket(["Noor", "Kai", "Elena", "Tomás"][Math.floor(Math.random() * 4)], [randomDrink(), randomDrink()])} className="border-edge rounded border px-3 py-1">Add random two-drink ticket</button>
          <button onClick={importSquare} className="border-taro text-taro rounded border px-3 py-1">Import open orders from Square sandbox</button>
        </div>
        {squareMsg && <p className="text-husk" aria-live="polite">{squareMsg}</p>}
      </section>
    </div>
  );
}

function randomDrink(): Drink {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
  return { recipeId: pick(RECIPES).id, size: pick(["regular", "large"] as const), sugar: pick([0, 50, 70, 100] as const), ice: pick(["regular", "less", "none"] as const), toppings: [pick(TOPPING_IDS)] };
}

function Log() {
  const log = useShop((s) => s.shop.log);
  if (log.length === 0) return <p className="text-husk">No turns yet. Speak or use the typed test.</p>;
  return (
    <ul className="space-y-3">
      {log.map((l) => (
        <li key={l.at + l.transcript} className="border-leaf border-b pb-2">
          <p><span className={l.result === "applied" ? "text-matcha" : "text-error"}>{l.result.replace("_", " ")}</span> <span className="text-husk">{new Date(l.at).toLocaleTimeString()}</span> “{l.transcript}”</p>
          <pre className="text-husk overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(l.actions)}</pre>
          <p className="text-cream/80">{l.speech}</p>
        </li>
      ))}
    </ul>
  );
}
