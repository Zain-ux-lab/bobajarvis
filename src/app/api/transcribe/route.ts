// POST /api/transcribe — body is a 16 kHz mono PCM WAV. Runs local whisper.cpp.
// Fast path: whisper-server (model stays loaded, ~0.2 s). Fallback: whisper-cli (reloads model, ~0.5 s).
// Audio never leaves this machine.

import { connection } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";


const CLI = process.env.WHISPER_CLI_PATH || "whisper-cli";
const SERVER = process.env.WHISPER_SERVER_URL || "http://127.0.0.1:8178";
const MODEL = process.env.WHISPER_MODEL_PATH || path.join(/*turbopackIgnore: true*/ process.cwd(), ".models", "ggml-base.en.bin");
// Biases whisper toward shop vocabulary so "taro" isn't heard as "tarah" as often.
const VOCAB = "Bubble tea shop. Order 104 for Maya. Taro, matcha, oolong, jasmine, tapioca pearls, popping boba, fructose, Yakult, restock, less ice, 50% sugar.";

export async function GET() {
  await connection(); // read env/disk at request time, not at build time
  const ok = await access(MODEL).then(() => true, () => false);
  const server = await fetch(SERVER, { signal: AbortSignal.timeout(500) }).then(() => true, () => false);
  return Response.json({ cli: CLI, model: path.basename(MODEL), modelFound: ok, engine: server ? "whisper-server" : "whisper-cli" });
}

export async function POST(req: Request) {
  const audio = Buffer.from(await req.arrayBuffer());
  // 44-byte header + at least 0.3 s of 16 kHz 16-bit audio
  if (audio.length < 44 + 16000 * 2 * 0.3 || audio.toString("ascii", 0, 4) !== "RIFF") {
    return Response.json({ error: "Recording too short or not a WAV file." }, { status: 400 });
  }
  if (!(await access(MODEL).then(() => true, () => false))) {
    return Response.json({ error: `Whisper model not found at ${path.basename(MODEL)}. See README "Audio setup" or set WHISPER_MODEL_PATH.` }, { status: 500 });
  }

  const fast = await viaServer(audio, req.signal);
  if (req.signal.aborted) return new Response(null, { status: 499 });
  if (fast !== null) return Response.json({ text: clean(fast), engine: "whisper-server" });

  const dir = await mkdtemp(path.join(tmpdir(), "bobajarvis-"));
  const file = path.join(dir, "turn.wav");
  try {
    await writeFile(file, audio);
    const text = await new Promise<string>((resolve, reject) => {
      const child = execFile(/*turbopackIgnore: true*/ CLI, ["-m", MODEL, "-f", file, "-l", "en", "-nt", "-np", "--prompt", VOCAB], { timeout: 20_000 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stderr }));
        else resolve(stdout);
      });
      req.signal.addEventListener("abort", () => child.kill("SIGKILL"), { once: true }); // stale turn: stop work
    });
    return Response.json({ text: clean(text), engine: "whisper-cli" });
  } catch (e) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    const message = err.code === "ENOENT" ? `${CLI} not found. Install whisper.cpp (brew install whisper-cpp) or set WHISPER_CLI_PATH.` : `Whisper failed: ${(err.stderr || err.message).slice(-300)}`;
    return Response.json({ error: message }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Drop whisper's non-speech markers like [BLANK_AUDIO] or (music). */
function clean(text: string) {
  return text.replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]|\((?:[^)]*)\)/gi, "").replace(/\s+/g, " ").trim();
}

/** Returns the transcript, or null if whisper-server isn't running/answering (caller falls back to the CLI). */
async function viaServer(audio: Buffer, signal: AbortSignal): Promise<string | null> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "turn.wav");
  form.append("response_format", "json");
  form.append("prompt", VOCAB);
  try {
    const res = await fetch(`${SERVER}/inference`, { method: "POST", body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: string };
    return typeof body.text === "string" ? body.text : null;
  } catch {
    return null;
  }
}
