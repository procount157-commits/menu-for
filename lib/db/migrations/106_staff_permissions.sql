-- Staff permissions: the owner picks, per person, what they may do — the
-- queue, orders, bookings, the menu, customers, reports, settings, chats,
-- marketing, or everything («مدير كامل»). NULL keeps what the person's role
-- gave before (staff: queue, orders, bookings; manager: those plus the menu,
-- customers, reports and settings).

ALTER TABLE staff ADD COLUMN IF NOT EXISTS permissions jsonb;
