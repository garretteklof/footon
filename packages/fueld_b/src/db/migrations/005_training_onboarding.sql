-- Friendly labels extend existing profiles; identities and ownership stay intact.
ALTER TABLE users ADD COLUMN display_name TEXT;
-- Legacy environment references remain readable until an account is reconnected.
ALTER TABLE training_plan_accounts ADD COLUMN credential_ref TEXT;
