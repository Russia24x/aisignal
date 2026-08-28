/**
 * One-time migration: v2 access model (see docs/ACCESS-MODEL.md).
 *
 * Before v2, a one-time "PLATFORM_ACCESS" product (5 PENGU) permanently
 * unlocked the dashboard. In v2, entry is FREE and signal content requires
 * time-based access passes. To stay fair to legacy buyers, every user who
 * paid for platform access and has no AccessGrant at all receives a
 * complimentary 30-day LEGACY_PLATFORM grant (counted from their original
 * purchase date — if that window has already passed, they keep their free
 * tier like everyone else).
 *
 * Idempotent: users who already hold ANY grant are skipped, so this script
 * can be re-run safely. Run once per environment after deploying v2:
 *
 *   bun scripts/migrate-legacy-access.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const LEGACY_GRANT_DAYS = 30;

async function main() {
  const legacyUsers = await db.user.findMany({
    where: { platformAccessAt: { not: null } },
    select: { id: true, address: true, platformAccessAt: true },
  });

  console.log(`[migrate-legacy-access] users with platformAccessAt: ${legacyUsers.length}`);

  let granted = 0;
  let skipped = 0;
  let expired = 0;

  for (const u of legacyUsers) {
    const since = u.platformAccessAt!;
    const grantCount = await db.accessGrant.count({ where: { userId: u.id } });
    if (grantCount > 0) {
      skipped++;
      continue;
    }
    const expiresAt = new Date(since.getTime() + LEGACY_GRANT_DAYS * 24 * 3600 * 1000);
    if (expiresAt.getTime() <= Date.now()) {
      expired++;
      console.log(`  - ${u.address}: legacy window already past, stays on free tier`);
      continue;
    }
    await db.accessGrant.create({
      data: {
        userId: u.id,
        product: "LEGACY_PLATFORM",
        startsAt: since,
        expiresAt,
      },
    });
    granted++;
    console.log(`  + ${u.address}: LEGACY_PLATFORM grant until ${expiresAt.toISOString()}`);
  }

  console.log(
    `[migrate-legacy-access] done — granted: ${granted}, skipped (has grants): ${skipped}, window past: ${expired}`,
  );
}

main()
  .catch((err) => {
    console.error("[migrate-legacy-access] FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
