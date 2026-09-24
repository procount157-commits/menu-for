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

import { and, eq } from "drizzle-orm";
import { db, llmSettingsTable } from "@workspace/db";
import { logger } from "./logger";

export type Provider =
  | "anthropic" | "gemini" | "groq" | "openrouter"
  | "zhipu" | "qwen" | "deepseek" | "moonshot" | "siliconflow"
  | "pollinations" | "none";

export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmResult  { text: string; provider: Provider }

const KEYS: Record<string, () => string> = {
  anthropic:   () => process.env["ANTHROPIC_API_KEY"]   ?? "",
  gemini:      () => process.env["GEMINI_API_KEY"]      ?? "",
  groq:        () => process.env["GROQ_API_KEY"]        ?? "",
  openrouter:  () => process.env["OPENROUTER_API_KEY"]  ?? "",
  zhipu:       () => process.env["ZHIPU_API_KEY"]       ?? "",
  qwen:        () => process.env["QWEN_API_KEY"]        ?? "",
  deepseek:    () => process.env["DEEPSEEK_API_KEY"]    ?? "",
  moonshot:    () => process.env["MOONSHOT_API_KEY"]    ?? "",
  siliconflow: () => process.env["SILICONFLOW_API_KEY"] ?? "",
};

// Everything except Gemini speaks the OpenAI chat-completions shape, so they
// differ only by base URL and model name.
const OPENAI_COMPATIBLE: Record<string, { url: string; model: string }> = {
  groq:        { url: "https://api.groq.com/openai/v1/chat/completions",
                 model: process.env["GROQ_MODEL"] ?? "llama-3.3-70b-versatile" },
  openrouter:  { url: "https://openrouter.ai/api/v1/chat/completions",
                 model: process.env["OPENROUTER_MODEL"] ?? "meta-llama/llama-3.3-70b-instruct:free" },
  // Zhipu's GLM-4-Flash is free outright rather than trial credit.
  zhipu:       { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
                 model: process.env["ZHIPU_MODEL"] ?? "glm-4-flash" },
  qwen:        { url: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
                 model: process.env["QWEN_MODEL"] ?? "qwen-turbo" },
  deepseek:    { url: "https://api.deepseek.com/v1/chat/completions",
                 model: process.env["DEEPSEEK_MODEL"] ?? "deepseek-chat" },
  moonshot:    { url: "https://api.moonshot.cn/v1/chat/completions",
                 model: process.env["MOONSHOT_MODEL"] ?? "moonshot-v1-8k" },
  siliconflow: { url: "https://api.siliconflow.cn/v1/chat/completions",
                 model: process.env["SILICONFLOW_MODEL"] ?? "Qwen/Qwen2.5-7B-Instruct" },
};

// Checked against a live key: gemini-2.0-flash and gemini-2.5-flash are both
// retired ("no longer available to new users"), and the heavier flash models
// spend their output budget on reasoning and truncate a two-line reply.
// flash-lite answers these grounded, short questions cleanly and fast.
const GEMINI_MODEL = process.env["GEMINI_MODEL"] ?? "gemini-flash-lite-latest";

// Claude is not OpenAI-compatible — its own request shape, below.
const ANTHROPIC_MODEL  = process.env["ANTHROPIC_MODEL"]  ?? "claude-opus-5";
// Short, knowledge-grounded replies do not need deep reasoning, and effort is
// the main cost lever within one model. Raise it if answers come out thin.
const ANTHROPIC_EFFORT = process.env["ANTHROPIC_EFFORT"] ?? "low";

// ── Stored credentials ────────────────────────────────────────────
// A key set from the UI lives in the database, so it survives a restart and
// does not need an SSH session and a redeploy to change. Cached briefly
// because it is read on every call; a save clears the cache immediately so a
// new key takes effect without waiting for it to expire.
let stored: { provider: Provider; apiKey: string; model: string | null } | null = null;
let storedAt = 0;
const STORED_TTL_MS = 30_000;

export function invalidateStoredProvider() { storedAt = 0; stored = null; }

async function loadStored() {
  if (storedAt && Date.now() - storedAt < STORED_TTL_MS) return stored;
  try {
    const [row] = await db.select().from(llmSettingsTable).limit(1);
    stored = row ? { provider: row.provider as Provider, apiKey: row.apiKey, model: row.model } : null;
    storedAt = Date.now();
  } catch {
    // Keep whatever was cached — a database blip must not disable the model.
  }
  return stored;
}

/** Which provider will be used, given what is configured. */
// Tried in order when LLM_PROVIDER is not set. Free-and-reliable first.
const PREFERENCE: Provider[] = [
  "anthropic", "gemini", "zhipu", "groq", "qwen", "siliconflow", "openrouter", "deepseek", "moonshot",
];

export function activeProvider(): Provider {
  const explicit = (process.env["LLM_PROVIDER"] ?? "").toLowerCase() as Provider;
  if (explicit && explicit !== "none") return explicit;
  for (const p of PREFERENCE) if (KEYS[p]?.()) return p;
  if (process.env["ALLOW_POLLINATIONS"] === "true") return "pollinations";
  return "none";
}

/** The provider actually in force, stored credentials included. */
export async function resolveProvider(): Promise<{ provider: Provider; apiKey: string; model: string | null } | null> {
  const row = await loadStored();
  if (row?.apiKey) return row;
  const p = activeProvider();
  if (p === "none") return null;
  return { provider: p, apiKey: KEYS[p]?.() ?? "", model: null };
}

export async function providerStatusAsync() {
  const row = await loadStored();
  const base = providerStatus();
  if (!row?.apiKey) return base;
  return {
    ...base,
    provider: row.provider,
    configured: true,
    source: "database" as const,
    model: row.model,
    // Enough to recognise which key is in place, not enough to use it.
    maskedKey: row.apiKey.length > 10
      ? `${row.apiKey.slice(0, 4)}…${row.apiKey.slice(-4)}`
      : "…",
  };
}

export function providerStatus() {
  const p = activeProvider();
  return {
    provider: p,
    configured: p !== "none",
    // Named so the UI can tell the owner exactly what to go and get.
    options: [
      { id: "anthropic",   label: "Claude (Anthropic)",  url: "https://console.anthropic.com/settings/keys", env: "ANTHROPIC_API_KEY",  note: "مدفوع بالتوكن — اشتراك claude.ai لا يصلح، الـAPI منفصل", region: "عالمي" },
      { id: "gemini",      label: "Google Gemini",       url: "https://aistudio.google.com/apikey",         env: "GEMINI_API_KEY",      note: "الأفضل للعربية، طبقة مجانية سخية", region: "عالمي" },
      { id: "zhipu",       label: "Zhipu GLM-4-Flash",   url: "https://open.bigmodel.cn/usercenter/apikeys", env: "ZHIPU_API_KEY",      note: "مجاني بالكامل، صيني", region: "صيني" },
      { id: "qwen",        label: "Qwen (علي بابا)",      url: "https://dashscope.console.aliyun.com/apiKey", env: "QWEN_API_KEY",       note: "حصة مجانية، عربية جيدة", region: "صيني" },
      { id: "siliconflow", label: "SiliconFlow",         url: "https://cloud.siliconflow.cn/account/ak",    env: "SILICONFLOW_API_KEY", note: "نماذج مجانية متعددة", region: "صيني" },
      { id: "deepseek",    label: "DeepSeek",            url: "https://platform.deepseek.com/api_keys",     env: "DEEPSEEK_API_KEY",    note: "رصيد تجريبي ثم رخيص جداً", region: "صيني" },
      { id: "moonshot",    label: "Moonshot Kimi",       url: "https://platform.moonshot.cn/console/api-keys", env: "MOONSHOT_API_KEY", note: "رصيد تجريبي", region: "صيني" },
      { id: "groq",        label: "Groq",                url: "https://console.groq.com/keys",              env: "GROQ_API_KEY",        note: "الأسرع، طبقة مجانية", region: "عالمي" },
      { id: "openrouter",  label: "OpenRouter",          url: "https://openrouter.ai/keys",                 env: "OPENROUTER_API_KEY",  note: "نماذج مجانية متعددة", region: "عالمي" },
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

async function callGemini(messages: LlmMessage[], timeoutMs: number, apiKey: string): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest   = messages.filter((m) => m.role !== "system");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
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

/**
 * Claude, via the Messages API.
 *
 * Not OpenAI-compatible: the system prompt is a top-level field rather than a
 * message, `max_tokens` is required, and the reply arrives as a list of
 * content blocks that has to be filtered by type.
 */
async function callAnthropic(messages: LlmMessage[], timeoutMs: number, apiKey: string): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest   = messages.filter((m) => m.role !== "system");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1_024,
      ...(system ? { system } : {}),
      output_config: { effort: ANTHROPIC_EFFORT },
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);

  const d = await res.json() as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  // A policy decline comes back as a 200 with stop_reason "refusal", so the
  // reason has to be checked before the content is read.
  if (d.stop_reason === "refusal") throw new Error("anthropic: الطلب رُفض");
  return (d.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
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
  const resolved = await resolveProvider();
  if (!resolved || !resolved.apiKey) return null;
  const { provider } = resolved;
  // A stored key has to win over the environment for the whole call, so the
  // per-provider lookups below read through this rather than process.env.
  const keyFor = (id: string) => (id === provider ? resolved.apiKey : (KEYS[id]?.() ?? ""));

  try {
    let text = "";
    if (provider === "anthropic") {
      text = await callAnthropic(messages, timeoutMs, keyFor("anthropic"));
    } else if (provider === "gemini") {
      text = await callGemini(messages, timeoutMs, keyFor("gemini"));
    } else if (provider === "pollinations") {
      text = await callPollinations(messages, timeoutMs);
    } else {
      const cfg = OPENAI_COMPATIBLE[provider];
      if (!cfg) return null;
      text = await callOpenAiCompatible(
        cfg.url, keyFor(provider), resolved.model || cfg.model, messages, timeoutMs,
      );
    }
    if (!text) return null;
    return { text, provider };
  } catch (err: any) {
    logger.warn({ provider, err: String(err?.message ?? err).slice(0, 160) }, "LLM call failed");
    return null;
  }
}
