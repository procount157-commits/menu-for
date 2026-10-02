-- A barbershop's chairs: one queue per barber, named after him, with his
-- photo, so a customer picks whose line to join («محفوظ: قدامك 2»). Only a
-- shop of kind «barber» can make one; every other shop's queues stay «line».

ALTER TABLE queues ADD COLUMN IF NOT EXISTS kind varchar(10) NOT NULL DEFAULT 'line';
ALTER TABLE queues ADD COLUMN IF NOT EXISTS photo_url text;
