import type { ApiRequest } from "./http.js";

type ShortTextRequest = {
  task: "short_text";
  prompt: string;
  system?: string;
  cacheKey: string;
  fallback: string;
  maxChars?: number;
  ip?: string | null;
};

type StructuredRequest = {
  task: "structured_reasoning";
  prompt: string;
  system?: string;
  cacheKey: string;
  fallback: Record<string, unknown>;
  ip?: string | null;
};

type AiRouterRequest = ShortTextRequest | StructuredRequest;

type AiRouterResponse =
  | { ok: true; mode: "ai" | "cache" | "fallback"; data: Record<string, unknown> | string; provider?: "groq" | "gemini"; warning?: string }
  | { ok: false; mode: "fallback"; data: Record<string, unknown> | string; warning: string };

type CacheValue = { expiresAt: number; value: unknown; provider?: "groq" | "gemini" };

const aiCache = new Map<string, CacheValue>();
const aiRateWindow = new Map<string, number[]>();

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

const clean = (value: string | undefined): string => (value ?? "").trim();

const aiEnv = {
  groqApiKey: clean(process.env.GROQ_API_KEY),
  geminiApiKey: clean(process.env.GEMINI_API_KEY),
};

const nowMs = () => Date.now();

const sanitizeText = (value: unknown, maxChars = 500): string =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);

const sanitizeJsonObject = <T extends Record<string, unknown>>(value: unknown): T => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = sanitizeText(v, 500);
    } else if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (typeof item === "string" ? sanitizeText(item, 200) : item));
    } else if (typeof v === "object") {
      out[k] = sanitizeJsonObject(v);
    }
  }
  return out as T;
};

const parseJsonLoose = <T extends Record<string, unknown>>(input: string): T | null => {
  try {
    return sanitizeJsonObject<T>(JSON.parse(input));
  } catch {
    const match = input.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return sanitizeJsonObject<T>(JSON.parse(match[0]));
    } catch {
      return null;
    }
  }
};

const getCached = <T>(cacheKey: string): { hit: boolean; value?: T; provider?: "groq" | "gemini" } => {
  const cached = aiCache.get(cacheKey);
  if (!cached) return { hit: false };
  if (cached.expiresAt <= nowMs()) {
    aiCache.delete(cacheKey);
    return { hit: false };
  }
  return { hit: true, value: cached.value as T, provider: cached.provider };
};

const setCache = (cacheKey: string, value: unknown, provider: "groq" | "gemini") => {
  aiCache.set(cacheKey, { value, provider, expiresAt: nowMs() + DEFAULT_CACHE_TTL_MS });
};

const applyRateLimit = (ip: string | null | undefined, routeKey: string): { ok: boolean; reason?: string } => {
  const key = `${ip || "anon"}:${routeKey}`;
  const cutoff = nowMs() - RATE_LIMIT_WINDOW_MS;
  const entries = (aiRateWindow.get(key) ?? []).filter((t) => t > cutoff);
  if (entries.length >= RATE_LIMIT_MAX_REQUESTS) {
    aiRateWindow.set(key, entries);
    return { ok: false, reason: "AI rate limit exceeded. Please retry shortly." };
  }
  entries.push(nowMs());
  aiRateWindow.set(key, entries);
  return { ok: true };
};

const callGroqShortText = async (prompt: string, system = "You write concise premium ecommerce text."): Promise<string> => {
  if (!aiEnv.groqApiKey) throw new Error("GROQ_API_KEY missing");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiEnv.groqApiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      temperature: 0.6,
      max_tokens: 220,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Groq failed (${response.status}): ${sanitizeText(txt, 180)}`);
  }
  const json = (await response.json()) as any;
  return sanitizeText(json?.choices?.[0]?.message?.content ?? "", 600);
};

const callGeminiStructured = async <T extends Record<string, unknown>>(
  prompt: string,
  system = "Return strictly valid JSON only."
): Promise<T> => {
  if (!aiEnv.geminiApiKey) throw new Error("GEMINI_API_KEY missing");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(
    aiEnv.geminiApiKey
  )}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`Gemini failed (${response.status}): ${sanitizeText(txt, 180)}`);
  }
  const json = (await response.json()) as any;
  const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  const parsed = parseJsonLoose<T>(text);
  if (!parsed) throw new Error("Gemini returned invalid JSON");
  return sanitizeJsonObject<T>(parsed);
};

export const getAiClientIp = (req: ApiRequest): string | null => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  const realIp = req.headers["x-real-ip"];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? null;
};

export const aiRouterGenerate = async (input: AiRouterRequest): Promise<AiRouterResponse> => {
  const rate = applyRateLimit(input.ip, input.task);
  if (!rate.ok) {
    return {
      ok: false,
      mode: "fallback",
      data: input.fallback as Record<string, unknown> | string,
      warning: rate.reason ?? "rate_limited",
    };
  }

  const cached = getCached<Record<string, unknown> | string>(input.cacheKey);
  if (cached.hit) {
      return { ok: true, mode: "cache", data: cached.value as Record<string, unknown> | string, provider: cached.provider };
  }

  try {
    if (input.task === "short_text") {
      const text = await callGroqShortText(input.prompt, input.system);
      const cleanText = sanitizeText(text, input.maxChars ?? 180);
      if (!cleanText) throw new Error("empty_response");
      setCache(input.cacheKey, cleanText, "groq");
      return { ok: true, mode: "ai", data: cleanText, provider: "groq" };
    }

    const structured = await callGeminiStructured<Record<string, unknown>>(input.prompt, input.system);
    if (!structured || typeof structured !== "object") throw new Error("invalid_structured_output");
    setCache(input.cacheKey, structured, "gemini");
    return { ok: true, mode: "ai", data: structured, provider: "gemini" };
  } catch (error) {
    const warning = error instanceof Error ? error.message : "ai_provider_error";
    return {
      ok: false,
      mode: "fallback",
      data: input.fallback as Record<string, unknown> | string,
      warning: sanitizeText(warning, 180),
    };
  }
};
