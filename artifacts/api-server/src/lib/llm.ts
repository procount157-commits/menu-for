// ── Language model access ─────────────────────────────────────────
// Provider-agnostic, because the only genuinely keyless option is not
// dependable. Measured, not assumed: text.pollinations.ai answered three
// trivial prompts in a row, then failed every one of six realistic
// knowledge-base questions including retries with backoff, and at times
// returned HTML rather than JSON. It stays here as a last resort, never as
// the thing customer replies rely on.
//
// The providers below all have a free tier and need a free key:
//   gemini      https://aistudio.google.com/apikey       — best Arabic
//   groq        https://console.groq.com/keys            — fastest
//   openrouter  https://openrouter.ai/keys               — ":free" models
//
// Set LLM_API_KEY plus LLM_PROVIDER, or just the provider-specific key.
// With none set, callers fall back to answering from the knowledge base
// directly, which needs no network at all.

import { logger } from "./logger";

export type Provider = "gemini" | "groq" | "openrouter" | "pollinations" | "none";

export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmResult  { text: string; provider: Provider }

const KEYS = {
  gemini:     () => process.env["GEMINI_API_KEY"]     ?? "",
  groq:       () => process.env["GROQ_API_KEY"]       ?? "",
  openrouter: () => process.env["OPENROUTER_API_KEY"] ?? "",
};

const MODELS = {
  gemini:     process.env["GEMINI_MODEL"]     ?? "gemini-2.0-flash",
  groq:       process.env["GROQ_MODEL"]       ?? "llama-3.3-70b-versatile",
  openrouter: process.env["OPENROUTER_MODEL"] ?? "meta-llama/llama-3.3-70b-instruct:free",
};

/** Which provider will be used, given what is configured. */
export function activeProvider(): Provider {
  const explicit = (process.env["LLM_PROVIDER"] ?? "").toLowerCase() as Provider;
  if (explicit && explicit !== "none") return explicit;
  if (KEYS.gemini())     return "gemini";
  if (KEYS.groq())       return "groq";
  if (KEYS.openrouter()) return "openrouter";
  if (process.env["ALLOW_POLLINATIONS"] === "true") return "pollinations";
  return "none";
}

export function providerStatus() {
  const p = activeProvider();
  return {
    provider: p,
    configured: p !== "none",
    // Named so the UI can tell the owner exactly what to go and get.
    options: [
      { id: "gemini",     label: "Google Gemini", url: "https://aistudio.google.com/apikey", env: "GEMINI_API_KEY", note: "الأفضل للعربية، طبقة مجانية سخية" },
      { id: "groq",       label: "Groq",          url: "https://console.groq.com/keys",      env: "GROQ_API_KEY",   note: "الأسرع، طبقة مجانية" },
      { id: "openrouter", label: "OpenRouter",    url: "https://openrouter.ai/keys",         env: "OPENROUTER_API_KEY", note: "نماذج مجانية متعددة" },
    ],
  };
}

// Pollinations serves one request per IP at a time, so calls are queued rather
// than fired concurrently — concurrency is what produced "Queue full" here.
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function callGemini(messages: LlmMessage[], timeoutMs: number): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest   = messages.filter((m) => m.role !== "system");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent?key=${KEYS.gemini()}`,
    {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: rest.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const d = await res.json() as any;
  return d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() ?? "";
}

async function callOpenAiCompatible(
  url: string, key: string, model: string, messages: LlmMessage[], timeoutMs: number,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 400 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const d = await res.json() as any;
  return d?.choices?.[0]?.message?.content?.trim() ?? "";
}

async function callPollinations(messages: LlmMessage[], timeoutMs: number): Promise<string> {
  return serialize(async () => {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages, seed: -1, private: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    // It sometimes answers with an HTML error page, so parsing is guarded.
    let d: any; try { d = JSON.parse(body); } catch { throw new Error("pollinations: غير JSON"); }
    if (d?.error) throw new Error(`pollinations: ${String(d.error).slice(0, 60)}`);
    const t = d?.choices?.[0]?.message?.content?.trim();
    if (!t) throw new Error("pollinations: رد فارغ");
    return t;
  });
}

/**
 * Ask the configured model.
 *
 * Returns null rather than throwing: every caller has a non-AI path, and a
 * provider being down must never break message handling.
 */
export async function complete(messages: LlmMessage[], timeoutMs = 20_000): Promise<LlmResult | null> {
  const provider = activeProvider();
  if (provider === "none") return null;

  try {
    let text = "";
    switch (provider) {
      case "gemini":     text = await callGemini(messages, timeoutMs); break;
      case "groq":       text = await callOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", KEYS.groq(), MODELS.groq, messages, timeoutMs); break;
      case "openrouter": text = await callOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", KEYS.openrouter(), MODELS.openrouter, messages, timeoutMs); break;
      case "pollinations": text = await callPollinations(messages, timeoutMs); break;
      default: return null;
    }
    if (!text) return null;
    return { text, provider };
  } catch (err: any) {
    logger.warn({ provider, err: String(err?.message ?? err).slice(0, 160) }, "LLM call failed");
    return null;
  }
}
