import {
  pgTable, serial, integer, varchar, text, boolean, timestamp, jsonb, numeric, date,
  index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Menu For You ──────────────────────────────────────────────────
// Everything here sits on top of Flow Hub rather than inside it. Flow Hub
// isolates every row by `user_id`, and every WhatsApp session, campaign and
// knowledge entry belongs to one. A branch is therefore one such unit
// (`branches.wa_user_id`), and an org is the layer above that Flow Hub never
// had: the owner, their branches, their staff, and one menu for all of them.

// ── Org, branches, staff ──────────────────────────────────────────

export const orgsTable = pgTable("orgs", {
  id:          serial("id").primaryKey(),
  ownerUserId: integer("owner_user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  name:        varchar("name", { length: 160 }).notNull(),
  nameEn:      varchar("name_en", { length: 160 }),
  slug:        varchar("slug", { length: 60 }).notNull().unique(),
  // restaurant | cafe | sweets | beauty — vocabulary and defaults, not a different engine.
  vertical:    varchar("vertical", { length: 20 }).notNull().default("restaurant"),
  tagline:     varchar("tagline", { length: 200 }),
  taglineEn:   varchar("tagline_en", { length: 200 }),
  about:       text("about"),
  logoUrl:     text("logo_url"),
  coverUrl:    text("cover_url"),
  // { template: "noir"|"cream"|"clean"|"rose", brand: "#22c55e", font?: string }
  theme:       jsonb("theme").$type<OrgTheme>().notNull().default({ template: "noir", brand: "#22c55e" }),
  defaultLang: varchar("default_lang", { length: 2 }).notNull().default("ar"),
  currency:    varchar("currency", { length: 3 }).notNull().default("AED"),
  timezone:    varchar("timezone", { length: 40 }).notNull().default("Asia/Dubai"),
  socials:     jsonb("socials").$type<Record<string, string>>().notNull().default({}),
  // Super-admin switches on top of the plan: { email: true, ... }
  features:    jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
  status:      varchar("status", { length: 20 }).notNull().default("active"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export interface OrgTheme {
  template: "noir" | "cream" | "clean" | "rose";
  brand: string;
  font?: string;
}

export interface DayHours { open: string; close: string; closed?: boolean }
/** Keyed 0 (Sunday) … 6 (Saturday). A close before open runs past midnight. */
export type WeekHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayHours>>;

export const branchesTable = pgTable("branches", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  // The Flow Hub account this branch lives in: the owner's own for a branch
  // on the main number, a service account for a branch with its own number.
  waUserId:     integer("wa_user_id").notNull().references(() => usersTable.id),
  name:         varchar("name", { length: 160 }).notNull(),
  nameEn:       varchar("name_en", { length: 160 }),
  slug:         varchar("slug", { length: 60 }).notNull(),
  address:      text("address"),
  mapUrl:       text("map_url"),
  displayPhone: varchar("display_phone", { length: 30 }),
  // The number customers write to — the linked WhatsApp, kept here so the
  // order and queue links work while the session is reconnecting.
  waPhone:      varchar("wa_phone", { length: 20 }),
  hours:        jsonb("hours").$type<WeekHours>().notNull().default({}),
  // The shop's own phones (owner, manager) told about a new order or booking.
  alertPhones:  jsonb("alert_phones").$type<string[]>().notNull().default([]),
  displayToken: varchar("display_token", { length: 32 }).notNull(),
  isActive:     boolean("is_active").notNull().default(true),
  sort:         integer("sort").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_branch_slug").on(t.orgId, t.slug),
  index("idx_branch_wa_user").on(t.waUserId),
]);

export const staffTable = pgTable("staff", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  // null = every branch of the org
  branchId:     integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
  name:         varchar("name", { length: 120 }).notNull(),
  username:     varchar("username", { length: 40 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  // manager: a branch admin (settings, reports) · staff: the queue and orders
  role:         varchar("role", { length: 20 }).notNull().default("staff"),
  isActive:     boolean("is_active").notNull().default(true),
  lastLoginAt:  timestamp("last_login_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("uq_staff_username").on(t.orgId, t.username)]);

// ── Menu ──────────────────────────────────────────────────────────

export const menuCategoriesTable = pgTable("menu_categories", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  name:      varchar("name", { length: 120 }).notNull(),
  nameEn:    varchar("name_en", { length: 120 }),
  imageUrl:  text("image_url"),
  sort:      integer("sort").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_menu_cat_org").on(t.orgId, t.sort)]);

export interface ItemImage { url: string; sm?: string; md?: string; blur?: string }
export interface OptionChoice { name: string; nameEn?: string; priceDelta: number }
export interface OptionGroup { name: string; nameEn?: string; required: boolean; min: number; max: number; choices: OptionChoice[] }

export const menuItemsTable = pgTable("menu_items", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  categoryId:    integer("category_id").references(() => menuCategoriesTable.id, { onDelete: "set null" }),
  // product: something ordered · service: something booked, with a duration
  kind:          varchar("kind", { length: 10 }).notNull().default("product"),
  name:          varchar("name", { length: 160 }).notNull(),
  nameEn:        varchar("name_en", { length: 160 }),
  description:   text("description"),
  descriptionEn: text("description_en"),
  price:         numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  compareAtPrice: numeric("compare_at_price", { precision: 10, scale: 2 }),
  durationMin:   integer("duration_min"),
  images:        jsonb("images").$type<ItemImage[]>().notNull().default([]),
  options:       jsonb("options").$type<OptionGroup[]>().notNull().default([]),
  // new | popular | spicy | vegetarian | chef | preorder
  tags:          jsonb("tags").$type<string[]>().notNull().default([]),
  calories:      integer("calories"),
  allergens:     jsonb("allergens").$type<string[]>().notNull().default([]),
  sort:          integer("sort").notNull().default(0),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_menu_item_org").on(t.orgId, t.categoryId, t.sort)]);

export const branchItemOverridesTable = pgTable("branch_item_overrides", {
  branchId:    integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
  itemId:      integer("item_id").notNull().references(() => menuItemsTable.id, { onDelete: "cascade" }),
  isAvailable: boolean("is_available").notNull().default(true),
  // null = the org's price
  price:       numeric("price", { precision: 10, scale: 2 }),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.branchId, t.itemId] })]);

export const offersTable = pgTable("offers", {
  id:        serial("id").primaryKey(),
  orgId:     integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId:  integer("branch_id").references(() => branchesTable.id, { onDelete: "cascade" }),
  title:     varchar("title", { length: 160 }).notNull(),
  titleEn:   varchar("title_en", { length: 160 }),
  body:      text("body"),
  bodyEn:    text("body_en"),
  imageUrl:  text("image_url"),
  itemId:    integer("item_id").references(() => menuItemsTable.id, { onDelete: "set null" }),
  startsAt:  timestamp("starts_at", { withTimezone: true }),
  endsAt:    timestamp("ends_at", { withTimezone: true }),
  sort:      integer("sort").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_offer_org").on(t.orgId)]);

// ── Queue ─────────────────────────────────────────────────────────

export const queuesTable = pgTable("queues", {
  id:            serial("id").primaryKey(),
  orgId:         integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId:      integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
  name:          varchar("name", { length: 80 }).notNull(),
  nameEn:        varchar("name_en", { length: 80 }),
  prefix:        varchar("prefix", { length: 3 }).notNull().default("A"),
  isOpen:        boolean("is_open").notNull().default(true),
  isPaused:      boolean("is_paused").notNull().default(false),
  // The owner's own estimate, used until the day has evidence of its own.
  avgServiceMin: integer("avg_service_min").notNull().default(5),
  // The staff's manual nudge on top of the computed wait, in minutes.
  etaAdjustMin:  integer("eta_adjust_min").notNull().default(0),
  maxWaiting:    integer("max_waiting").notNull().default(150),
  notifyAhead:   integer("notify_ahead").notNull().default(2),
  noShowMin:     integer("no_show_min").notNull().default(5),
  autoNoShow:    boolean("auto_no_show").notNull().default(false),
  // anyone: the link works from anywhere · qr_only: the in-store rotating QR
  remoteJoin:    varchar("remote_join", { length: 10 }).notNull().default("anyone"),
  askPartySize:  boolean("ask_party_size").notNull().default(true),
  askService:    boolean("ask_service").notNull().default(false),
  sort:          integer("sort").notNull().default(0),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_queue_branch").on(t.branchId)]);

export const queueCountersTable = pgTable("queue_counters", {
  queueId:    integer("queue_id").notNull().references(() => queuesTable.id, { onDelete: "cascade" }),
  serviceDay: date("service_day").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.queueId, t.serviceDay] })]);

export const queueTicketsTable = pgTable("queue_tickets", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId:     integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
  queueId:      integer("queue_id").notNull().references(() => queuesTable.id, { onDelete: "cascade" }),
  serviceDay:   date("service_day").notNull(),
  number:       integer("number").notNull(),
  displayCode:  varchar("display_code", { length: 10 }).notNull(),
  token:        varchar("token", { length: 32 }).notNull().unique(),
  joinCode:     varchar("join_code", { length: 6 }).notNull(),
  customerName: varchar("customer_name", { length: 80 }),
  partySize:    integer("party_size").notNull().default(1),
  serviceItemId: integer("service_item_id").references(() => menuItemsTable.id, { onDelete: "set null" }),
  phone:        varchar("phone", { length: 40 }),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  // waiting → called → serving → done · or no_show / cancelled / left
  status:       varchar("status", { length: 12 }).notNull().default("waiting"),
  priority:     integer("priority").notNull().default(0),
  // qr | link | staff | whatsapp | booking
  source:       varchar("source", { length: 12 }).notNull().default("link"),
  note:         text("note"),
  joinedAt:     timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  calledAt:     timestamp("called_at", { withTimezone: true }),
  servingAt:    timestamp("serving_at", { withTimezone: true }),
  finishedAt:   timestamp("finished_at", { withTimezone: true }),
  calledBy:     integer("called_by"),
  recallCount:  integer("recall_count").notNull().default(0),
  onMyWayAt:    timestamp("on_my_way_at", { withTimezone: true }),
  aheadNotifiedAt: timestamp("ahead_notified_at", { withTimezone: true }),
  etaAtJoinMin: integer("eta_at_join_min"),
  bookingId:    integer("booking_id"),
  deviceId:     varchar("device_id", { length: 40 }),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
}, (t) => [
  uniqueIndex("uq_ticket_number").on(t.queueId, t.serviceDay, t.number),
  index("idx_ticket_queue_status").on(t.queueId, t.serviceDay, t.status),
  index("idx_ticket_join_code").on(t.joinCode),
  index("idx_ticket_phone").on(t.orgId, t.phone),
]);

export const queueEventsTable = pgTable("queue_events", {
  id:       serial("id").primaryKey(),
  queueId:  integer("queue_id").notNull().references(() => queuesTable.id, { onDelete: "cascade" }),
  ticketId: integer("ticket_id").references(() => queueTicketsTable.id, { onDelete: "cascade" }),
  // joined | called | recalled | serving | done | no_show | cancelled | left | requeued | paused | resumed | opened | closed | eta_adjusted
  type:     varchar("type", { length: 16 }).notNull(),
  staffId:  integer("staff_id"),
  detail:   text("detail"),
  at:       timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_queue_events").on(t.queueId, t.at)]);

// ── Orders ────────────────────────────────────────────────────────

export interface OrderLine {
  itemId: number;
  name: string;
  nameEn?: string | null;
  qty: number;
  unitPrice: number;
  options: Array<{ group: string; choice: string; priceDelta: number }>;
  note?: string;
  lineTotal: number;
}

export const ordersTable = pgTable("orders", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId:     integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
  code:         varchar("code", { length: 6 }).notNull(),
  token:        varchar("token", { length: 32 }).notNull().unique(),
  // dine_in | pickup | delivery | preorder
  type:         varchar("type", { length: 10 }).notNull().default("pickup"),
  tableLabel:   varchar("table_label", { length: 20 }),
  customerName: varchar("customer_name", { length: 80 }),
  phone:        varchar("phone", { length: 40 }),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  address:      text("address"),
  items:        jsonb("items").$type<OrderLine[]>().notNull(),
  subtotal:     numeric("subtotal", { precision: 10, scale: 2 }).notNull(),
  notes:        text("notes"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  // pending (link opened, no message yet) → received → preparing → ready → completed · cancelled
  status:       varchar("status", { length: 12 }).notNull().default("pending"),
  ticketId:     integer("ticket_id"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_orders_branch").on(t.branchId, t.createdAt),
  index("idx_orders_code").on(t.code),
]);

// ── Bookings ──────────────────────────────────────────────────────

export const bookingSettingsTable = pgTable("booking_settings", {
  branchId:          integer("branch_id").primaryKey().references(() => branchesTable.id, { onDelete: "cascade" }),
  enabled:           boolean("enabled").notNull().default(false),
  slotMin:           integer("slot_min").notNull().default(30),
  // tables or chairs per slot; for services, how many at once
  capacityPerSlot:   integer("capacity_per_slot").notNull().default(4),
  leadTimeMin:       integer("lead_time_min").notNull().default(60),
  maxDaysAhead:      integer("max_days_ahead").notNull().default(14),
  maxParty:          integer("max_party").notNull().default(10),
  reminderBeforeMin: integer("reminder_before_min").notNull().default(120),
  autoConfirm:       boolean("auto_confirm").notNull().default(true),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bookingsTable = pgTable("bookings", {
  id:           serial("id").primaryKey(),
  orgId:        integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  branchId:     integer("branch_id").notNull().references(() => branchesTable.id, { onDelete: "cascade" }),
  code:         varchar("code", { length: 6 }).notNull(),
  token:        varchar("token", { length: 32 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 80 }).notNull(),
  phone:        varchar("phone", { length: 40 }),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  partySize:    integer("party_size").notNull().default(2),
  itemId:       integer("item_id").references(() => menuItemsTable.id, { onDelete: "set null" }),
  staffId:      integer("staff_id"),
  startsAt:     timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt:       timestamp("ends_at", { withTimezone: true }).notNull(),
  // pending → confirmed → arrived → done · or cancelled / no_show
  status:       varchar("status", { length: 12 }).notNull().default("confirmed"),
  notes:        text("notes"),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  source:       varchar("source", { length: 12 }).notNull().default("link"),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_bookings_branch").on(t.branchId, t.startsAt),
  index("idx_bookings_code").on(t.code),
]);

// ── Customers ─────────────────────────────────────────────────────
// One row per phone per org — the restaurant's equivalent of Flow Hub's lead
// card, which tracks licences and tax status and means nothing here.

export const customersTable = pgTable("customers", {
  orgId:          integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  phone:          varchar("phone", { length: 40 }).notNull(),
  name:           varchar("name", { length: 80 }),
  firstSeenAt:    timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt:     timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  // The last message they sent us — what makes a notification a reply in a
  // thread they started rather than a message to a stranger.
  lastInboundAt:  timestamp("last_inbound_at", { withTimezone: true }),
  visits:         integer("visits").notNull().default(0),
  ordersCount:    integer("orders_count").notNull().default(0),
  bookingsCount:  integer("bookings_count").notNull().default(0),
  noShows:        integer("no_shows").notNull().default(0),
  totalSpent:     numeric("total_spent", { precision: 12, scale: 2 }).notNull().default("0"),
  favourites:     jsonb("favourites").$type<Record<string, number>>().notNull().default({}),
  marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
  optInAt:        timestamp("opt_in_at", { withTimezone: true }),
  lastBranchId:   integer("last_branch_id"),
  ratingLast:     integer("rating_last"),
  reviewAskedAt:  timestamp("review_asked_at", { withTimezone: true }),
  winbackAt:      timestamp("winback_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.phone] }),
  index("idx_customers_seen").on(t.orgId, t.lastSeenAt),
]);

// ── WhatsApp notifications ────────────────────────────────────────

export const waTemplatesTable = pgTable("wa_templates", {
  id:      serial("id").primaryKey(),
  orgId:   integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  key:     varchar("key", { length: 30 }).notNull(),
  textAr:  text("text_ar").notNull(),
  textEn:  text("text_en"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("uq_wa_template").on(t.orgId, t.key)]);

export const notificationsTable = pgTable("notifications", {
  id:          serial("id").primaryKey(),
  orgId:       integer("org_id").notNull().references(() => orgsTable.id, { onDelete: "cascade" }),
  waUserId:    integer("wa_user_id").notNull(),
  phone:       varchar("phone", { length: 40 }).notNull(),
  kind:        varchar("kind", { length: 30 }).notNull(),
  refType:     varchar("ref_type", { length: 10 }),
  refId:       integer("ref_id"),
  text:        text("text").notNull(),
  // replied: inside a thread the customer opened in the last 24h
  // consented: a number they typed themselves and agreed to be told on
  class:       varchar("class", { length: 10 }).notNull(),
  status:      varchar("status", { length: 10 }).notNull().default("queued"),
  reason:      text("reason"),
  expiresAt:   timestamp("expires_at", { withTimezone: true }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt:      timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt:      timestamp("read_at", { withTimezone: true }),
  waMessageId: varchar("wa_message_id", { length: 80 }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_notifications_due").on(t.status, t.scheduledAt),
  index("idx_notifications_org").on(t.orgId, t.createdAt),
]);

// ── Platform settings ─────────────────────────────────────────────
// The super admin's own switches, one JSON value per key — e.g.
// `module_defaults`: which of the queue and bookings a new shop of each kind
// starts with.

export const platformSettingsTable = pgTable("platform_settings", {
  key:       varchar("key", { length: 60 }).primaryKey(),
  value:     jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Org          = typeof orgsTable.$inferSelect;
export type Branch       = typeof branchesTable.$inferSelect;
export type Staff        = typeof staffTable.$inferSelect;
export type MenuCategory = typeof menuCategoriesTable.$inferSelect;
export type MenuItem     = typeof menuItemsTable.$inferSelect;
export type Offer        = typeof offersTable.$inferSelect;
export type Queue        = typeof queuesTable.$inferSelect;
export type QueueTicket  = typeof queueTicketsTable.$inferSelect;
export type Order        = typeof ordersTable.$inferSelect;
export type Booking      = typeof bookingsTable.$inferSelect;
export type BookingSettings = typeof bookingSettingsTable.$inferSelect;
export type Customer     = typeof customersTable.$inferSelect;
export type WaTemplate   = typeof waTemplatesTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
