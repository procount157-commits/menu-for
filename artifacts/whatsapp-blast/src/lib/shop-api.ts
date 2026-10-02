// ── The dashboard's way to the Menu For You API ───────────────────
// One fetch helper, the signed-in shop (useShop), and live streams with a
// polling fallback (useStream). Every shop page uses these rather than its
// own copy.

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Vocab, Vertical } from "@workspace/menu-shared";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

/** JSON in, JSON out; throws ApiError with the server's Arabic message. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch(`${BASE}${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await r.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) throw new ApiError(r.status, body?.error ?? `فشل الطلب (${r.status})`, body);
  return body as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, json: unknown = {}) => api<T>(p, { method: "POST", json });
export const patch = <T = any>(p: string, json: unknown = {}) => api<T>(p, { method: "PATCH", json });
export const put = <T = any>(p: string, json: unknown = {}) => api<T>(p, { method: "PUT", json });
export const del = <T = any>(p: string) => api<T>(p, { method: "DELETE" });

/** Multipart upload (images, spreadsheets). */
export async function upload<T = any>(path: string, file: File, field = "file"): Promise<T> {
  const fd = new FormData();
  fd.append(field, file);
  return api<T>(path, { method: "POST", body: fd });
}

// ── The signed-in shop ────────────────────────────────────────────

export type Role = "owner" | "manager" | "staff";

export interface WaState { connected: boolean; status: string; phone: string | null }

export interface ShopBranch {
  id: number; name: string; nameEn: string | null; slug: string; isActive: boolean;
  ownNumber: boolean; wa: WaState; menuUrl: string;
}

export interface Plan {
  plan: string; planName: string; expired: boolean; expiresAt: string | null;
  limits: { branches: number; items: number; staff: number };
  /** What the shop can use now: the plan, narrowed by the shop's own switches. */
  features: PlanFeatures;
  /** The plan alone — what the owner could switch on. */
  planFeatures: PlanFeatures;
  /** The shop's own queue and booking switches. */
  modules: { queue: boolean; booking: boolean };
}

export interface PlanFeatures { queue: boolean; booking: boolean; notify: boolean; marketing: boolean; display: boolean; branchNumbers: boolean; email: boolean }

export interface ShopMe {
  needsOnboarding?: false;
  role: Role;
  person: { id: number; name: string | null; phone?: string; username?: string; isAdmin?: boolean } | null;
  impersonating: boolean;
  org: {
    id: number; ownerUserId: number; name: string; nameEn: string | null; slug: string; vertical: Vertical;
    tagline: string | null; taglineEn: string | null; about: string | null; logoUrl: string | null; coverUrl: string | null;
    theme: { template: "noir" | "cream" | "clean" | "rose"; brand: string; font?: string };
    defaultLang: "ar" | "en"; currency: string; timezone: string; socials: Record<string, string>;
    features: Record<string, boolean>; status: string; onboardedAt: string | null; createdAt: string;
  };
  vocab: Vocab;
  branch: {
    id: number; orgId: number; waUserId: number; name: string; nameEn: string | null; slug: string;
    address: string | null; mapUrl: string | null; displayPhone: string | null; waPhone: string | null;
    hours: Record<string, { open: string; close: string; closed?: boolean }>; displayToken: string; isActive: boolean; ownNumber: boolean;
  };
  branches: ShopBranch[];
  plan: Plan;
  /** Bookings are on for this branch and in the plan. */
  booking: { enabled: boolean };
  wa: WaState;
  links: { menu: string; display: string };
}

export type ShopMeResponse = ShopMe | { needsOnboarding: true; person: ShopMe["person"] };

export const SHOP_KEY = ["/api/tenancy/me"] as const;

export function useShopQuery() {
  return useQuery<ShopMeResponse>({ queryKey: SHOP_KEY, queryFn: () => get("/api/tenancy/me"), staleTime: 10_000 });
}

/** The shop, once it exists. Pages under ShopGate can rely on it. */
export function useShop(): ShopMe {
  const { data } = useShopQuery();
  if (!data || data.needsOnboarding) throw new Error("useShop outside ShopGate");
  return data;
}

/** Switch branch, then refetch everything (every Flow Hub screen follows the branch). */
export function useSwitchBranch() {
  const qc = useQueryClient();
  return async (branchId: number) => {
    await post("/api/tenancy/branch", { branchId });
    await qc.invalidateQueries();
  };
}

// ── Live data ─────────────────────────────────────────────────────

/**
 * Subscribe to an SSE endpoint that sends `{type:"update", data}`. Falls back
 * to polling `pollUrl` (default: the stream URL without /stream) every
 * `pollMs` while the stream is down. Returns the latest data.
 */
export function useStream<T>(url: string | null, opts: { pollUrl?: string; pollMs?: number; initial?: T } = {}): { data: T | undefined; live: boolean; refresh: () => void } {
  const [data, setData] = useState<T | undefined>(opts.initial);
  const [live, setLive] = useState(false);
  const pollUrl = opts.pollUrl ?? url?.replace(/\/stream(\?|$)/, "$1") ?? null;
  const tick = useRef(0);
  const [, force] = useState(0);

  const refresh = () => { tick.current++; force((n) => n + 1); };

  useEffect(() => {
    if (!url) return;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const startPoll = () => {
      if (poll || !pollUrl) return;
      const run = () => get<T>(pollUrl).then((d) => !stopped && setData(d)).catch(() => {});
      run();
      poll = setInterval(run, opts.pollMs ?? 10_000);
    };
    const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    try {
      es = new EventSource(`${BASE}${url}`, { withCredentials: true });
      es.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m?.type === "update") { setData(m.data); setLive(true); stopPoll(); }
        } catch { /* ignore */ }
      };
      es.onerror = () => { setLive(false); startPoll(); };
    } catch { startPoll(); }
    return () => { stopped = true; es?.close(); stopPoll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick.current]);

  return { data, live, refresh };
}

// ── Small shared bits ─────────────────────────────────────────────

export const inputCls = "w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";
export const labelCls = "block text-sm text-muted-foreground mb-1.5";
export const cardCls = "bg-card border border-card-border rounded-xl p-4";

export function minutesAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}
