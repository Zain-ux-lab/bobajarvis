"use client";
// The voice loop:  Idle -> Listening -> Transcribing -> Thinking -> Speaking -> Listening
// Mic audio is captured continuously but IGNORED unless we are Listening (feedback gate).
// Every async step checks `generation`; an interrupt bumps it so late results are dropped.

import { TARGET_RATE, concat, encodeWav, resample, rms } from "./wav";

export type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

const PRE_ROLL_MS = 400; // keep audio from just before speech starts so the first word survives
export const END_SILENCE_MS = 650; // this much quiet ends the utterance (was 900; shorter = snappier turns)
const MIN_VOICED_MS = 250; // shorter = cough/clank, discard
const MAX_UTTERANCE_MS = 15_000;
const RESUME_AFTER_SPEAK_MS = 400;
const TICK_EVERY_MS = 900; // "still working" tick while waiting for transcription/brain

const UNIT_WORDS: Record<string, [one: string, many: string]> = { L: ["litre", "litres"], ml: ["millilitre", "millilitres"], g: ["gram", "grams"], kg: ["kilogram", "kilograms"] };

/** Screen text says "1.4 L"; the voice should say "1.4 litres", not the letter L. */
export function spoken(text: string): string {
  return text.replace(/(\d+(?:\.\d+)?) (L|ml|g|kg)\b/g, (_, n: string, u: string) => `${n} ${UNIT_WORDS[u][n === "1" ? 0 : 1]}`);
}

/** Timing of the last turn, measured from when the barista stopped talking. */
export interface TurnTiming {
  waitMs: number; // silence needed to know they finished
  hearMs: number; // transcription
  thinkMs: number; // brain + executor (+ Square update when completing an order)
  totalMs: number;
}

export interface EarpieceHandlers {
  /** Execute the transcript; return text to speak, or null if the turn went stale. */
  onTranscript: (text: string) => Promise<string | null>;
  onCancel: () => void;
  onChange: () => void;
  onError: (message: string) => void;
}

export class Earpiece {
  state: VoiceState = "idle";
  level = 0; // 0..1 for the orb
  pushToTalk = false;
  cues = true; // short sounds so the barista knows they were heard without looking
  lastTiming: TurnTiming | null = null;

  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private proc: ScriptProcessorNode | null = null;
  private preRoll: Float32Array[] = [];
  private recording: Float32Array[] | null = null;
  private voicedMs = 0;
  private silenceMs = 0;
  private loudFrames = 0;
  private noiseFloor = 0.01;
  private generation = 0;
  private transcribeAbort: AbortController | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private h: EarpieceHandlers) {}

  async start() {
    if (this.state !== "idle") return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      this.h.onError(name === "NotAllowedError" ? "Microphone permission was denied. Allow it in the browser's site settings." : name === "NotFoundError" ? "No microphone found." : `Microphone error: ${name}`);
      return;
    }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    // shortcut: ScriptProcessorNode is deprecated but simple; move to an AudioWorklet if it glitches.
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.proc.onaudioprocess = (e) => this.onFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination); // required for onaudioprocess to fire; output is silent
    speechSynthesis.getVoices(); // warm up voice list
    this.setState("listening");
  }

  stop() {
    this.generation++;
    this.transcribeAbort?.abort();
    this.h.onCancel();
    speechSynthesis.cancel();
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.proc = null;
    this.recording = null;
    this.preRoll = [];
    this.level = 0;
    this.setState("idle");
  }

  /** Orb click / Spacebar: stop talking or thinking, drop the old turn, listen again. */
  interrupt() {
    if (this.state === "idle") return;
    this.generation++;
    this.transcribeAbort?.abort();
    this.h.onCancel();
    speechSynthesis.cancel();
    this.recording = null;
    this.listenSoon(150);
  }

  setCues(on: boolean) {
    this.cues = on;
  }

  setPushToTalk(on: boolean) {
    this.pushToTalk = on;
    this.recording = null;
  }

  setPttHeld(held: boolean) {
    if (!this.pushToTalk || this.state === "idle") return;
    if (held && this.state !== "listening") this.interrupt();
    if (held && !this.recording) this.beginRecording();
    if (!held && this.recording) this.finishRecording();
  }

  /** Speak through browser speech synthesis, then resume listening. */
  say(text: string, gen = this.generation) {
    speechSynthesis.cancel();
    this.recording = null; // drop any partial capture
    this.setState("speaking");
    const u = new SpeechSynthesisUtterance(spoken(text));
    u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith("en") && /Samantha|Google US|Natural/i.test(v.name)) ?? null;
    u.rate = 1.08;
    const done = () => gen === this.generation && this.listenSoon(RESUME_AFTER_SPEAK_MS);
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  private listenSoon(ms: number) {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      if (this.ctx) this.setState("listening");
    }, ms);
  }

  private setState(s: VoiceState) {
    if (s !== "transcribing" && s !== "thinking" && this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.state = s;
    this.h.onChange();
  }

  private onFrame(frame: Float32Array) {
    if (!this.ctx) return;
    const ms = (frame.length / this.ctx.sampleRate) * 1000;
    const level = rms(frame);
    this.level = Math.min(1, level * 12);
    if (this.state !== "listening") return; // feedback gate: never capture our own voice

    const threshold = Math.max(0.012, this.noiseFloor * 2.5);
    if (!this.recording) {
      this.preRoll.push(frame);
      while (this.preRoll.length * ms > PRE_ROLL_MS) this.preRoll.shift();
      if (this.pushToTalk) return;
      if (level > threshold) {
        if (++this.loudFrames >= 2) this.beginRecording();
      } else {
        this.loudFrames = 0;
        this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05; // adapt to shop background noise
      }
      return;
    }

    this.recording.push(frame);
    if (level > threshold * 0.7) {
      this.voicedMs += ms;
      this.silenceMs = 0;
    } else this.silenceMs += ms;
    const total = this.recording.length * ms;
    if (!this.pushToTalk && (this.silenceMs >= END_SILENCE_MS || total >= MAX_UTTERANCE_MS)) this.finishRecording();
    if (this.pushToTalk && total >= MAX_UTTERANCE_MS) this.finishRecording();
  }

  private beginRecording() {
    this.recording = [...this.preRoll];
    this.preRoll = [];
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.loudFrames = 0;
    this.h.onChange();
  }

  private finishRecording() {
    const chunks = this.recording;
    this.recording = null;
    if (!chunks || !this.ctx) return;
    if (this.voicedMs < MIN_VOICED_MS) return; // silence or a clank: keep listening
    const wav = encodeWav(resample(concat(chunks), this.ctx.sampleRate, TARGET_RATE));
    void this.transcribe(wav);
  }

  /**
   * Short synthesized tones, played only while the mic is gated (not Listening),
   * so they can never be transcribed as speech.
   *   heard: two rising notes = "got your words"
   *   tick:  quiet click = "still working"
   *   error: one low note = "that didn't work"
   */
  private cue(kind: "heard" | "tick" | "error") {
    if (!this.cues || !this.ctx) return;
    const notes: [freq: number, startS: number, lenS: number, vol: number][] =
      kind === "heard" ? [[660, 0, 0.07, 0.07], [880, 0.08, 0.09, 0.07]] : kind === "tick" ? [[520, 0, 0.03, 0.03]] : [[220, 0, 0.22, 0.08]];
    const now = this.ctx.currentTime;
    for (const [freq, start, len, vol] of notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(vol, now + start + 0.01); // tiny fade in/out avoids clicks
      gain.gain.linearRampToValueAtTime(0, now + start + len);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + len + 0.02);
    }
  }

  private async transcribe(wav: ArrayBuffer) {
    const gen = ++this.generation;
    const t0 = performance.now();
    this.transcribeAbort = new AbortController();
    this.setState("transcribing");
    this.cue("heard");
    this.tickTimer = setInterval(() => gen === this.generation && this.cue("tick"), TICK_EVERY_MS);
    let text = "";
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: wav, headers: { "content-type": "audio/wav" }, signal: this.transcribeAbort.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      text = body.text ?? "";
    } catch (e) {
      if (gen !== this.generation) return;
      this.h.onError(`Transcription failed: ${(e as Error).message}`);
      this.setState("transcribing"); // keep the mic gated while the error tone plays
      this.cue("error");
      this.listenSoon(300);
      return;
    }
    const t1 = performance.now();
    if (gen !== this.generation) return;
    if (text.replace(/[^a-z0-9]/gi, "").length < 2) return this.listenSoon(0); // nothing usable heard
    this.setState("thinking");
    const reply = await this.h.onTranscript(text);
    if (gen !== this.generation) return; // interrupted while thinking
    const t2 = performance.now();
    const waitMs = this.pushToTalk ? 0 : END_SILENCE_MS; // push-to-talk ends on key release, no silence wait
    this.lastTiming = { waitMs, hearMs: Math.round(t1 - t0), thinkMs: Math.round(t2 - t1), totalMs: Math.round(waitMs + t2 - t0) };
    if (reply) this.say(reply, gen);
    else this.listenSoon(0);
  }
}
