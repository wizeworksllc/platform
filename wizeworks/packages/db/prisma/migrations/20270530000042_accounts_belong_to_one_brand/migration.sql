-- A sign-in method belongs to one product, the same as its user.
--
-- 20270416000000_a_login_belongs_to_one_product split `users` by brand and left
-- `accounts` shared, because Better Auth reached an account only through its
-- user, and the user lookup was already filtered by brand. Better Auth 1.7
-- changed the order. A Google sign-in now looks up the account FIRST, by
-- (provider_id, account_id) alone, and only then reads its user. Google gives a
-- person the same account id in both products, so signing in to the second one
-- found the first one's row, read its user through the brand filter, got
-- nothing, and refused with `unable_to_link_account`. Every person who had
-- signed in with Google on one product was locked out of the other.
--
-- `accounts.platform_brand` puts each row on its user's product, and the unique
-- key widens to match: one Google identity may now hold one row per brand.
-- The brand-scoped client in @wizeworksllc/auth filters reads on it and stamps
-- it on Better Auth's creates.
--
-- ── WHY A PLAIN UPDATE ──────────────────────────────────────────────────────
--
-- 20260527162200_auth_tables_no_force_rls dropped FORCE from users/sessions/
-- accounts, so the owner sees every row and this backfill reaches all of them.
-- `accounts.user_id` is NOT NULL behind a cascading FK to `users`, so every row
-- has exactly one user and therefore exactly one brand. The column goes NOT
-- NULL only after the backfill, so a row the join missed fails the release
-- here rather than landing on a guessed brand.

ALTER TABLE "accounts" ADD COLUMN "platform_brand" VARCHAR(20);

UPDATE "accounts" a
   SET "platform_brand" = u."platform_brand"
  FROM "users" u
 WHERE a."user_id" = u."id";

ALTER TABLE "accounts" ALTER COLUMN "platform_brand" SET NOT NULL;

-- The wider key first, so no moment exists with neither in place.
CREATE UNIQUE INDEX "accounts_brand_provider_account_unique" ON "accounts"("platform_brand", "provider_id", "account_id");

DROP INDEX IF EXISTS "accounts_provider_id_account_id_key";
