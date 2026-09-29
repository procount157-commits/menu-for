import { pgTable, serial, integer, varchar, text, boolean, timestamp, jsonb, index, primaryKey, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Email marketing ───────────────────────────────────────────────
// The same shape as the WhatsApp side, on purpose: contacts and lists,
// campaigns that enqueue messages, a follow-up ladder, and events read back
// from the world so a campaign is judged by what happened, not by what was
// sent. See migration 024 for the reasoning per table.

export const emailSettingsTable = pgTable("email_settings", {
  userId:       integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  provider:     varchar("provider", { length: 20 }).notNull().default("smtp"),
  smtpHost:     varchar("smtp_host", { length: 200 }),
  smtpPort:     integer("smtp_port").default(587),
  smtpSecure:   boolean("smtp_secure").notNull().default(false),
  smtpUser:     varchar("smtp_user", { length: 200 }),
  smtpPass:     varchar("smtp_pass", { length: 400 }),
  apiKey:       varchar("api_key", { length: 400 }),
  fromName:     varchar("from_name", { length: 120 }),
  fromEmail:    varchar("from_email", { length: 200 }),
  replyTo:      varchar("reply_to", { length: 200 }),
  signature:    text("signature"),
  hourlyCap:    integer("hourly_cap").notNull().default(40),
  dailyCap:     integer("daily_cap").notNull().default(300),
  tracking:     boolean("tracking").notNull().default(true),
  imapHost:     varchar("imap_host", { length: 200 }),
  imapPort:     integer("imap_port").default(993),
  imapUser:     varchar("imap_user", { length: 200 }),
  imapPass:     varchar("imap_pass", { length: 400 }),
  imapLastUid:  integer("imap_last_uid").notNull().default(0),
  imapLastError: text("imap_last_error"),
  inboundToken: varchar("inbound_token", { length: 48 }),
  /** Send the salesman's drafts on their own, for low-risk intents only. */
  autoReply:    boolean("auto_reply").notNull().default(false),
  autoReplyDelayMin: integer("auto_reply_delay_min").notNull().default(12),
  /** Ramp a new sender from 50 a day whatever the daily cap says. */
  warmup:       boolean("warmup").notNull().default(true),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailContactsTable = pgTable("email_contacts", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  email:         varchar("email", { length: 254 }).notNull(),
  name:          varchar("name", { length: 160 }),
  company:       varchar("company", { length: 200 }),
  phone:         varchar("phone", { length: 50 }),
  industry:      varchar("industry", { length: 120 }),
  city:          varchar("city", { length: 120 }),
  source:        varchar("source", { length: 60 }),
  /** Canonical sector, worked out from the name and activity (lib/email/sector.ts). */
  sector:        varchar("sector", { length: 60 }),
  /** active | unsubscribed | bounced | complained */
  status:        varchar("status", { length: 20 }).notNull().default("active"),
  tags:          jsonb("tags").notNull().default([]),
  mxOk:          boolean("mx_ok"),
  lastSentAt:    timestamp("last_sent_at", { withTimezone: true }),
  lastOpenedAt:  timestamp("last_opened_at", { withTimezone: true }),
  lastRepliedAt: timestamp("last_replied_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_email_contacts_user").on(t.userId, t.status), unique().on(t.userId, t.email)]);

export const emailListsTable = pgTable("email_lists", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:        varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailListMembersTable = pgTable("email_list_members", {
  listId:    integer("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").notNull().references(() => emailContactsTable.id, { onDelete: "cascade" }),
  addedAt:   timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.listId, t.contactId] })]);

export const emailTemplatesTable = pgTable("email_templates", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:      varchar("name", { length: 160 }).notNull(),
  subject:   varchar("subject", { length: 300 }).notNull(),
  html:      text("html").notNull(),
  category:  varchar("category", { length: 60 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailSegmentsTable = pgTable("email_segments", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:      varchar("name", { length: 160 }).notNull(),
  filter:    jsonb("filter").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailCampaignsTable = pgTable("email_campaigns", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:        varchar("name", { length: 160 }).notNull(),
  listId:      integer("list_id").references(() => emailListsTable.id, { onDelete: "set null" }),
  /** A saved audience instead of a list; resolved when the campaign starts. */
  segmentId:   integer("segment_id"),
  missionId:   integer("mission_id"),
  /** owner | agent */
  createdBy:   varchar("created_by", { length: 20 }).notNull().default("owner"),
  subject:     varchar("subject", { length: 300 }).notNull(),
  html:        text("html").notNull(),
  /** draft | scheduled | sending | paused | completed */
  status:      varchar("status", { length: 20 }).notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt:   timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sentCount:   integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  openCount:   integer("open_count").notNull().default(0),
  clickCount:  integer("click_count").notNull().default(0),
  replyCount:  integer("reply_count").notNull().default(0),
  bounceCount: integer("bounce_count").notNull().default(0),
  unsubCount:  integer("unsub_count").notNull().default(0),
  pauseReason: text("pause_reason"),
  /** A second subject to test against the first. */
  subjectB:    varchar("subject_b", { length: 300 }),
  /** Share of the list that receives the test; 0 means no test. */
  abPct:       integer("ab_pct").notNull().default(0),
  abWaitHours: integer("ab_wait_hours").notNull().default(4),
  abWinner:    varchar("ab_winner", { length: 1 }),
  abDecidedAt: timestamp("ab_decided_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailSequencesTable = pgTable("email_sequences", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:        varchar("name", { length: 160 }).notNull(),
  /** [{ afterHours, subject, html }] */
  steps:       jsonb("steps").notNull().default([]),
  stopOnReply: boolean("stop_on_reply").notNull().default(true),
  stopOnOpen:  boolean("stop_on_open").notNull().default(false),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailSequenceJobsTable = pgTable("email_sequence_jobs", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sequenceId: integer("sequence_id").notNull().references(() => emailSequencesTable.id, { onDelete: "cascade" }),
  contactId:  integer("contact_id").notNull().references(() => emailContactsTable.id, { onDelete: "cascade" }),
  stepIndex:  integer("step_index").notNull(),
  dueAt:      timestamp("due_at", { withTimezone: true }).notNull(),
  /** pending | sent | cancelled | skipped | failed */
  status:     varchar("status", { length: 20 }).notNull().default("pending"),
  messageId:  integer("message_id"),
  error:      text("error"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_email_seq_jobs_due").on(t.status, t.dueAt), index("idx_email_seq_jobs_contact").on(t.userId, t.contactId, t.status)]);

export const emailMessagesTable = pgTable("email_messages", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  campaignId:    integer("campaign_id").references(() => emailCampaignsTable.id, { onDelete: "set null" }),
  sequenceJobId: integer("sequence_job_id").references(() => emailSequenceJobsTable.id, { onDelete: "set null" }),
  contactId:     integer("contact_id").references(() => emailContactsTable.id, { onDelete: "set null" }),
  toEmail:       varchar("to_email", { length: 254 }).notNull(),
  subject:       varchar("subject", { length: 300 }).notNull(),
  /** queued | ab_hold | sent | failed | bounced */
  status:        varchar("status", { length: 20 }).notNull().default("queued"),
  variant:       varchar("variant", { length: 1 }),
  providerId:    varchar("provider_id", { length: 200 }),
  token:         varchar("token", { length: 48 }).notNull().unique(),
  messageIdHdr:  varchar("message_id_hdr", { length: 300 }),
  sentAt:        timestamp("sent_at", { withTimezone: true }),
  openedAt:      timestamp("opened_at", { withTimezone: true }),
  openCount:     integer("open_count").notNull().default(0),
  clickedAt:     timestamp("clicked_at", { withTimezone: true }),
  clickCount:    integer("click_count").notNull().default(0),
  repliedAt:     timestamp("replied_at", { withTimezone: true }),
  bouncedAt:     timestamp("bounced_at", { withTimezone: true }),
  error:         text("error"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_email_messages_queue").on(t.userId, t.status, t.createdAt),
  index("idx_email_messages_campaign").on(t.campaignId),
  index("idx_email_messages_contact").on(t.contactId, t.createdAt),
]);

export const emailEventsTable = pgTable("email_events", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  messageId: integer("message_id").references(() => emailMessagesTable.id, { onDelete: "cascade" }),
  /** open | click | reply | bounce | unsubscribe | complaint | sent | failed */
  type:      varchar("type", { length: 20 }).notNull(),
  url:       text("url"),
  meta:      jsonb("meta").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_email_events_user").on(t.userId, t.createdAt)]);

export const emailInboundTable = pgTable("email_inbound", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  contactId:    integer("contact_id").references(() => emailContactsTable.id, { onDelete: "set null" }),
  messageId:    integer("message_id").references(() => emailMessagesTable.id, { onDelete: "set null" }),
  fromEmail:    varchar("from_email", { length: 254 }).notNull(),
  fromName:     varchar("from_name", { length: 160 }),
  subject:      varchar("subject", { length: 300 }),
  text:         text("text"),
  messageIdHdr: varchar("message_id_hdr", { length: 300 }),
  inReplyTo:    varchar("in_reply_to", { length: 300 }),
  intent:       varchar("intent", { length: 20 }),
  summary:      text("summary"),
  draftReply:   text("draft_reply"),
  draftSubject: varchar("draft_subject", { length: 300 }),
  /** new | drafted | sent | ignored */
  state:        varchar("state", { length: 20 }).notNull().default("new"),
  /** When the draft goes out on its own; null waits for a person. */
  autoSendAt:   timestamp("auto_send_at", { withTimezone: true }),
  receivedAt:   timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("idx_email_inbound_user").on(t.userId, t.receivedAt)]);

export type EmailSettings   = typeof emailSettingsTable.$inferSelect;
export type EmailContact    = typeof emailContactsTable.$inferSelect;
export type EmailCampaign   = typeof emailCampaignsTable.$inferSelect;
export type EmailSequence   = typeof emailSequencesTable.$inferSelect;
export type EmailMessage    = typeof emailMessagesTable.$inferSelect;
export type EmailInbound    = typeof emailInboundTable.$inferSelect;
export interface EmailStep { afterHours: number; subject: string; html: string }

export const emailMissionsTable = pgTable("email_missions", {
  id:               serial("id").primaryKey(),
  userId:           integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:             varchar("name", { length: 160 }).notNull(),
  goal:             text("goal").notNull(),
  filter:           jsonb("filter").notNull().default({}),
  language:         varchar("language", { length: 10 }).notNull().default("ar"),
  tone:             varchar("tone", { length: 40 }),
  /** draft | awaiting_approval | sending | following_up | done */
  stage:            varchar("stage", { length: 30 }).notNull().default("draft"),
  /** active | paused */
  status:           varchar("status", { length: 20 }).notNull().default("active"),
  requireApproval:  boolean("require_approval").notNull().default(true),
  pending:          jsonb("pending"),
  campaignId:       integer("campaign_id"),
  warmSequenceId:   integer("warm_sequence_id"),
  coldSequenceId:   integer("cold_sequence_id"),
  followAfterHours: integer("follow_after_hours").notNull().default(48),
  report:           jsonb("report"),
  lastRunAt:        timestamp("last_run_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailMissionLogTable = pgTable("email_mission_log", {
  id:        serial("id").primaryKey(),
  missionId: integer("mission_id").notNull().references(() => emailMissionsTable.id, { onDelete: "cascade" }),
  kind:      varchar("kind", { length: 20 }).notNull().default("note"),
  text:      text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EmailSegment = typeof emailSegmentsTable.$inferSelect;
export type EmailMission = typeof emailMissionsTable.$inferSelect;
export interface SegmentFilter {
  sectors?: string[];
  cities?: string[];
  listIds?: number[];
  statuses?: string[];
  /** never_sent | sent_no_open | opened_no_reply | clicked | replied */
  engagement?: string[];
  q?: string;
  /** Only contacts with a WhatsApp number on file. */
  hasPhone?: boolean;
}
