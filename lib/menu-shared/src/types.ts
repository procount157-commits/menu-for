// ── What the public pages receive ─────────────────────────────────
// The shapes of /api/public/*, shared so the menu page and the server cannot
// drift apart. Nothing here carries a phone number or another customer's name.

import type { OptionGroup } from "./pricing";
import type { WeekHours } from "./time";
import type { Template, Vertical } from "./vocab";
import type { EtaRange } from "./eta";

export interface PublicImage { url: string; sm?: string; md?: string; blur?: string }

export interface PublicOrg {
  id: number;
  name: string;
  nameEn: string | null;
  slug: string;
  vertical: Vertical;
  tagline: string | null;
  taglineEn: string | null;
  about: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  theme: { template: Template; brand: string; font?: string };
  currency: string;
  timezone: string;
  defaultLang: "ar" | "en";
  socials: Record<string, string>;
}

export interface PublicBranch {
  id: number;
  name: string;
  nameEn: string | null;
  slug: string;
  address: string | null;
  mapUrl: string | null;
  displayPhone: string | null;
  waPhone: string | null;
  hours: WeekHours;
  open: { open: boolean; known: boolean; closesAt?: string; opensAt?: string };
}

export interface PublicItem {
  id: number;
  categoryId: number | null;
  kind: "product" | "service";
  name: string;
  nameEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  price: number;
  compareAtPrice: number | null;
  durationMin: number | null;
  images: PublicImage[];
  options: OptionGroup[];
  tags: string[];
  calories: number | null;
  allergens: string[];
  available: boolean;
}

export interface PublicCategory { id: number; name: string; nameEn: string | null; imageUrl: string | null }

export interface PublicOffer {
  id: number;
  title: string;
  titleEn: string | null;
  body: string | null;
  bodyEn: string | null;
  imageUrl: string | null;
  itemId: number | null;
  endsAt: string | null;
}

export interface PublicQueue {
  id: number;
  name: string;
  nameEn: string | null;
  isOpen: boolean;
  isPaused: boolean;
  waiting: number;
  eta: EtaRange;
  askPartySize: boolean;
  askService: boolean;
  /** The join needs the in-store QR's rotating key. */
  qrOnly: boolean;
  full: boolean;
}

export interface PublicMenu {
  org: PublicOrg;
  branch: PublicBranch;
  branches: Array<{ id: number; name: string; nameEn: string | null; slug: string }>;
  categories: PublicCategory[];
  items: PublicItem[];
  offers: PublicOffer[];
  queues: PublicQueue[];
  booking: { enabled: boolean; maxParty: number; slotMin: number; maxDaysAhead: number; services: boolean } | null;
  ordering: { enabled: boolean; types: Array<"dine_in" | "pickup" | "delivery" | "preorder"> };
  /** Whether WhatsApp is linked for this branch right now. */
  whatsapp: boolean;
}

export type TicketStatus = "waiting" | "called" | "serving" | "done" | "no_show" | "cancelled" | "left";

export interface PublicTicket {
  token: string;
  displayCode: string;
  joinCode: string;
  status: TicketStatus;
  ahead: number;
  eta: EtaRange;
  partySize: number;
  customerName: string | null;
  joinedAt: string;
  calledAt: string | null;
  onMyWay: boolean;
  /** WhatsApp has confirmed the customer's number for this ticket. */
  whatsappLinked: boolean;
  /** wa.me link with the join message prefilled, when the branch has a number. */
  waLink: string | null;
  queue: { id: number; name: string; nameEn: string | null; isPaused: boolean; isOpen: boolean; noShowMin: number };
  nowServing: string[];
  org: { name: string; nameEn: string | null; slug: string; logoUrl: string | null; theme: PublicOrg["theme"]; vertical: Vertical; currency: string; defaultLang: "ar" | "en" };
  branch: { name: string; nameEn: string | null; slug: string; address: string | null; mapUrl: string | null };
}

export interface PublicDisplay {
  org: { name: string; nameEn: string | null; logoUrl: string | null; theme: PublicOrg["theme"]; slug: string };
  branch: { name: string; nameEn: string | null; slug: string };
  queues: Array<{ id: number; name: string; nameEn: string | null; nowServing: string[]; next: string[]; waiting: number; eta: EtaRange; isPaused: boolean; isOpen: boolean }>;
  offers: PublicOffer[];
  /** The in-store join key for qr_only queues; rotates. */
  joinKey: string;
  joinUrl: string;
}

export interface PublicOrderView {
  code: string;
  token: string;
  status: string;
  type: string;
  tableLabel: string | null;
  items: Array<{ name: string; nameEn?: string | null; qty: number; unitPrice: number; options: Array<{ group: string; choice: string }>; note?: string; lineTotal: number }>;
  subtotal: number;
  scheduledFor: string | null;
  whatsappLinked: boolean;
  waLink: string | null;
  createdAt: string;
  org: PublicTicket["org"];
  branch: PublicTicket["branch"];
}

export interface PublicBookingView {
  code: string;
  token: string;
  status: string;
  customerName: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  service: string | null;
  whatsappLinked: boolean;
  waLink: string | null;
  org: PublicTicket["org"] & { timezone: string };
  branch: PublicTicket["branch"];
}

/** What a stream sends: the whole view again, small enough that diffs are not worth it. */
export type StreamMessage<T> = { type: "update"; data: T } | { type: "ping" };
