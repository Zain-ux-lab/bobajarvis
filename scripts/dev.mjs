// `npm run dev`: starts whisper-server (keeps the speech model loaded for fast transcription)
// alongside the Next.js dev server, and stops it when you stop the app.
// If whisper-server can't start, the app still works: /api/transcribe falls back to whisper-cli.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const model = process.env.WHISPER_MODEL_PATH || ".models/ggml-base.en.bin";
const port = new URL(process.env.WHISPER_SERVER_URL || "http://127.0.0.1:8178").port || "8178";
const children = [];

if (existsSync(model)) {
  const ws = spawn(process.env.WHISPER_SERVER_PATH || "whisper-server", ["-m", model, "--port", port, "-l", "en", "-nt"], { stdio: "ignore" });
  ws.on("error", () => console.log("whisper-server not found; transcription will use whisper-cli (slower)."));
  ws.on("spawn", () => console.log(`whisper-server starting on port ${port}`));
  children.push(ws);
} else {
  console.log(`No Whisper model at ${model}; see README "Audio setup".`);
}

// Start Next directly (not via npx) so stopping the app really stops it: npx would leave Next running as a grandchild.
const next = spawn("node_modules/.bin/next", ["dev", ...process.argv.slice(2)], { stdio: "inherit" });
children.push(next);

const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", (code) => {
  stop();
  process.exit(code ?? 0);
});
