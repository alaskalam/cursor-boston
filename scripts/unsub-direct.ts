/**
 * Manual unsubscribe via direct Firestore write. Use this when the
 * token-based unsubscribe flow is broken (e.g., secret-mismatch incident
 * 2026-05-25) but a user has explicitly asked to be removed.
 *
 * Usage:
 *   npx tsx scripts/_unsub-direct.ts user@example.com [user2@example.com ...]
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase-admin";

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error("Pass one or more emails as args.");
    process.exit(1);
  }
  const db = getAdminDb();
  if (!db) throw new Error("no db");

  for (const email of emails) {
    const ref = db.collection("eventContacts").doc(email);
    const doc = await ref.get();
    if (!doc.exists) {
      console.log(`  [skip] ${email} — not in eventContacts`);
      continue;
    }
    await ref.update({
      unsubscribed: true,
      unsubscribedAt: FieldValue.serverTimestamp(),
      unsubscribedVia: "direct-firestore-2026-05-25-secret-mismatch-workaround",
    });
    console.log(`  [ok]   ${email} — marked unsubscribed`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
