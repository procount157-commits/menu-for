// ── The public pages ──────────────────────────────────────────────
// The server puts the page's data into the HTML (window.__MFY__), so the
// first paint needs no second request; in development the data is fetched.

import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicBookingView, PublicDisplay, PublicMenu, PublicOrderView, PublicTicket } from "@workspace/menu-shared";
import "./styles.css";
import { api, usePath } from "./lib/api";
import { initLang } from "./lib/i18n";
import { applyTheme } from "./lib/theme";
import { Spinner, Toaster } from "./components/ui";
import MenuPage from "./pages/Menu";
import NotFound from "./pages/NotFound";

const TicketPage = lazy(() => import("./pages/Ticket"));
const OrderPage = lazy(() => import("./pages/Order"));
const BookingPage = lazy(() => import("./pages/Booking"));
const DisplayPage = lazy(() => import("./pages/Display"));

type Boot =
  | { kind: "menu"; path: string; data: PublicMenu }
  | { kind: "ticket"; path: string; data: PublicTicket }
  | { kind: "order"; path: string; data: PublicOrderView }
  | { kind: "booking"; path: string; data: PublicBookingView }
  | { kind: "display"; path: string; data: PublicDisplay };

declare global { interface Window { __MFY__?: Boot } }

const boot = window.__MFY__ ?? null;

function route(path: string): { kind: Boot["kind"] | "none"; key: string; api: string | null } {
  const parts = path.split("/").filter(Boolean);
  const [a, b] = parts;
  if (!a) return { kind: "none", key: "", api: null };
  if (a === "t" && b) return { kind: "ticket", key: b, api: `/api/public/tickets/${b}` };
  if (a === "o" && b) return { kind: "order", key: b, api: `/api/public/orders/${b}` };
  if (a === "b" && b) return { kind: "booking", key: b, api: `/api/public/bookings/${b}` };
  if (a === "d" && b) return { kind: "display", key: b, api: `/api/public/display/${b}` };
  return { kind: "menu", key: parts.slice(0, 2).join("/"), api: `/api/public/m/${parts.slice(0, 2).join("/")}` };
}

function App() {
  const path = usePath();
  const r = route(path);
  const preset = boot && boot.path === path ? boot.data : null;
  const [state, setState] = useState<{ key: string; data: any; missing: boolean } | null>(preset ? { key: r.key, data: preset, missing: false } : null);

  useEffect(() => {
    if (state?.key === r.key) return;
    if (!r.api) { setState({ key: r.key, data: null, missing: true }); return; }
    let off = false;
    setState(null);
    api(r.api).then((d) => !off && setState({ key: r.key, data: d, missing: false }))
      .catch(() => !off && setState({ key: r.key, data: null, missing: true }));
    return () => { off = true; };
  }, [r.key]); // eslint-disable-line

  const data = state?.key === r.key ? state.data : null;
  useEffect(() => {
    if (!data) return;
    const org = data.org;
    applyTheme(org?.theme);
    initLang(org?.slug ?? null, (org?.defaultLang ?? "ar") as "ar" | "en");
    if (r.kind === "menu" && org) document.title = org.nameEn && document.documentElement.lang === "en" ? org.nameEn : org.name;
  }, [data]); // eslint-disable-line

  if (state?.missing && state.key === r.key) return <NotFound />;
  if (!data) return <div className="min-h-dvh flex items-center justify-center"><Spinner className="w-7 h-7 text-brand" /></div>;
  switch (r.kind) {
    case "menu": return <MenuPage key={r.key} initial={data} />;
    case "ticket": return <TicketPage token={r.key} initial={data} />;
    case "order": return <OrderPage token={r.key} initial={data} />;
    case "booking": return <BookingPage token={r.key} initial={data} />;
    case "display": return <DisplayPage token={r.key} initial={data} />;
    default: return <NotFound />;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="min-h-dvh flex items-center justify-center"><Spinner className="w-7 h-7 text-brand" /></div>}>
      <App />
    </Suspense>
    <Toaster />
  </StrictMode>,
);
