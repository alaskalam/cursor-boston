#!/usr/bin/env node
/**
 * Copyright (C) 2026 Cursor Boston
 * This file is part of Cursor Boston, licensed under GPL-3.0.
 * See LICENSE file for details.
 */

/**
 * T-2 closing push for the May 26 Sports Hack: make it explicit that the
 * Luma RSVP + Partiful RSVP are *interest signals* and do NOT reserve a
 * seat — the canonical attendance list is the website signup list, and the
 * top-{capacity} cut requires both a claim *and* a confirm-attendance click
 * on cursorboston.com.
 *
 * Recipient set mirrors send-sports-hack-2026-participation-rules.ts:
 * union of website signups + Luma-only, minus judges/declined/unsubscribed,
 * deduped by email + matching GitHub login. Carries its own stamp
 * (`sportsHack2026ConfirmAttendanceEmailedAt`) so it does NOT inherit the
 * participation-rules send suppression — this is a different message,
 * intentionally going to everyone (the user explicitly asked for full
 * blast, not just newcomers).
 *
 * Idempotent via `sportsHack2026ConfirmAttendanceEmailedAt` stamped on:
 *   - hackathonEventSignups/{id} for website signups
 *   - hackathonLumaRegistrants/{id} for Luma-only attendees
 *
 * Usage:
 *   npx tsx scripts/send-may26-confirm-attendance.ts --dry-run
 *   npx tsx scripts/send-may26-confirm-attendance.ts --send --only-email=rhunt@bentley.edu
 *   npx tsx scripts/send-may26-confirm-attendance.ts --send
 *   npx tsx scripts/send-may26-confirm-attendance.ts --send --force
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase-admin";
import { sendEmail } from "../lib/mailgun";
import { syncMailgunSuppressions } from "../lib/mailgun-suppressions";
import { buildUnsubscribeUrl } from "../lib/unsubscribe-token";
import {
  getDeclinedEmailsForEvent,
  getJudgeEmailsForEvent,
} from "../lib/hackathon-event-signup";
import {
  SPORTS_HACK_2026_CAPACITY,
  SPORTS_HACK_2026_EVENT_ID,
  SPORTS_HACK_2026_NAME,
} from "../lib/sports-hack-2026";

const EVENT_ID = SPORTS_HACK_2026_EVENT_ID;
const STAMP_FIELD = "sportsHack2026ConfirmAttendanceEmailedAt";

const SIGNUP_URL = `https://cursorboston.com/hackathons/${EVENT_ID}/signup`;
const EVENT_TIME_HUMAN =
  "Tuesday, May 26 · 10 AM – 4 PM ET · Hult International, Cambridge";

interface Recipient {
  email: string;
  firstName: string;
  source: "website" | "luma";
  sourceDocId: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getOnlyEmailFlag(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--only-email="));
  if (!arg) return null;
  return arg.slice("--only-email=".length).trim().toLowerCase();
}

function buildEmail(r: Recipient): { subject: string; html: string; text: string } {
  const first = escapeHtml(r.firstName?.trim() || "there");
  const firstText = r.firstName?.trim() || "there";
  const unsubUrl = buildUnsubscribeUrl(r.email);

  const subject =
    "Action needed — confirm your seat for Tuesday's Sports Hack (Luma/Partiful RSVPs don't reserve a spot)";

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#111;max-width:640px;">
<p>Hi ${first},</p>

<p>Quick, important one for <strong>${escapeHtml(SPORTS_HACK_2026_NAME)}</strong> — <strong>${escapeHtml(EVENT_TIME_HUMAN)}</strong>.</p>

<div style="border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;background:#fffbeb;color:#78350f;">
  <p style="margin:0 0 8px 0;"><strong>Your Luma or Partiful RSVP is an interest signal — it does not reserve a seat.</strong></p>
  <p style="margin:0;">The canonical attendance list — the one we use for door check-in and for the ${SPORTS_HACK_2026_CAPACITY}-credit Cursor cap — lives on the website. To be on it, you have to take two actions on cursorboston.com.</p>
</div>

<h3 style="margin-top:24px;margin-bottom:8px;">Do both of these before Tuesday:</h3>
<ol>
  <li style="margin-bottom:10px;"><strong>Claim your spot on the website.</strong> Sign in (or create an account) and click claim on the signup page. Required even if you&apos;re already on Luma or Partiful.</li>
  <li style="margin-bottom:10px;"><strong>Confirm attendance.</strong> Once you&apos;ve claimed, the same page shows a second button to confirm you&apos;re actually coming. Only confirmed attendees count toward the Cursor-credit cap and the door list.</li>
</ol>

<p><a href="${SIGNUP_URL}" style="display:inline-block;padding:12px 22px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Claim &amp; confirm on cursorboston.com →</a></p>

<p style="margin-top:20px;font-size:14px;color:#555;">Already claimed and confirmed? Thank you — nothing more to do. The same page shows your current rank and whether you&apos;re inside the ${SPORTS_HACK_2026_CAPACITY}-credit band.</p>

<p>See you Tuesday —</p>

<p>— Roger<br/>
<a href="mailto:roger@cursorboston.com">roger@cursorboston.com</a></p>

<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
You&apos;re receiving this because you registered for the Cursor Boston May 26 event on Luma, Partiful, or the website.<br/>
<a href="${escapeHtml(unsubUrl)}" style="color:#888;">Unsubscribe from emails</a>
</p>
</body></html>`;

  const text = `Hi ${firstText},

Quick, important one for ${SPORTS_HACK_2026_NAME} — ${EVENT_TIME_HUMAN}.

YOUR LUMA OR PARTIFUL RSVP IS AN INTEREST SIGNAL — IT DOES NOT RESERVE A SEAT.

The canonical attendance list — the one we use for door check-in and for the ${SPORTS_HACK_2026_CAPACITY}-credit Cursor cap — lives on the website. To be on it, you have to take two actions on cursorboston.com:

DO BOTH OF THESE BEFORE TUESDAY:

  1) CLAIM YOUR SPOT ON THE WEBSITE.
     Sign in (or create an account) and click claim on the signup page.
     Required even if you're already on Luma or Partiful.

  2) CONFIRM ATTENDANCE.
     Once you've claimed, the same page shows a second button to confirm
     you're actually coming. Only confirmed attendees count toward the
     Cursor-credit cap and the door list.

Claim & confirm on cursorboston.com:
${SIGNUP_URL}

Already claimed and confirmed? Thank you — nothing more to do. The same page shows your current rank and whether you're inside the ${SPORTS_HACK_2026_CAPACITY}-credit band.

See you Tuesday —

— Roger
roger@cursorboston.com

---
You're receiving this because you registered for the Cursor Boston May 26 event on Luma, Partiful, or the website.
Unsubscribe: ${unsubUrl}
`;

  return { subject, html, text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function firstNameFrom(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().split(/\s+/)[0] ?? "";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const send = process.argv.includes("--send");
  const force = process.argv.includes("--force");
  const onlyEmail = getOnlyEmailFlag();
  if ((dryRun && send) || (!dryRun && !send)) {
    console.error("Specify exactly one of: --dry-run | --send");
    process.exit(1);
  }

  if (send && (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN)) {
    console.error("For --send, set MAILGUN_API_KEY and MAILGUN_DOMAIN.");
    process.exit(1);
  }

  const db = getAdminDb();
  if (!db) {
    console.error("Firebase Admin not configured.");
    process.exit(1);
  }

  if (send) await syncMailgunSuppressions(db);

  const signupSnap = await db
    .collection("hackathonEventSignups")
    .where("eventId", "==", EVENT_ID)
    .get();
  const websiteUserIds = signupSnap.docs
    .map((d) => d.data().userId as string | undefined)
    .filter((u): u is string => Boolean(u));
  const userMap = new Map<string, FirebaseFirestore.DocumentData>();
  for (let i = 0; i < websiteUserIds.length; i += 10) {
    const chunk = websiteUserIds.slice(i, i + 10);
    const refs = chunk.map((id) => db.collection("users").doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) userMap.set(s.id, s.data() ?? {});
  }
  console.log(`Website signups (${EVENT_ID}): ${signupSnap.size}`);

  const lumaSnap = await db
    .collection("hackathonLumaRegistrants")
    .where("eventId", "==", EVENT_ID)
    .get();
  console.log(`Luma registrants (${EVENT_ID}): ${lumaSnap.size}`);

  const ecSnap = await db.collection("eventContacts").get();
  const unsubscribedEmails = new Set<string>();
  for (const doc of ecSnap.docs) {
    if (doc.data().unsubscribed === true) {
      const e = (doc.data().email || doc.id).toString().trim().toLowerCase();
      if (e) unsubscribedEmails.add(e);
    }
  }
  console.log(`Unsubscribed emails (global): ${unsubscribedEmails.size}`);

  const judgeEmails = getJudgeEmailsForEvent(EVENT_ID);
  const declinedEmails = getDeclinedEmailsForEvent(EVENT_ID);

  const recipients: Recipient[] = [];
  const seenEmails = new Set<string>();
  const websiteGithubLogins = new Set<string>();

  let skippedAlreadyEmailed = 0;
  let skippedOnlyEmailFilter = 0;
  let skippedJudgeOrDeclined = 0;
  let skippedUnsubscribed = 0;
  let skippedNoEmail = 0;

  for (const doc of signupSnap.docs) {
    const data = doc.data();
    const userId = data.userId as string | undefined;
    if (!userId) {
      skippedNoEmail++;
      continue;
    }
    const profile = userMap.get(userId) ?? {};
    const email =
      typeof profile.email === "string"
        ? profile.email.trim().toLowerCase()
        : null;
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    if (judgeEmails.has(email) || declinedEmails.has(email)) {
      skippedJudgeOrDeclined++;
      continue;
    }
    if (unsubscribedEmails.has(email)) {
      skippedUnsubscribed++;
      continue;
    }
    if (!force && data[STAMP_FIELD]) {
      skippedAlreadyEmailed++;
      continue;
    }
    if (onlyEmail && email !== onlyEmail) {
      skippedOnlyEmailFilter++;
      continue;
    }
    seenEmails.add(email);
    const ghLogin =
      profile.github && typeof profile.github === "object"
        ? (profile.github as { login?: string }).login ?? null
        : null;
    if (ghLogin) websiteGithubLogins.add(ghLogin.toLowerCase());
    recipients.push({
      email,
      firstName: firstNameFrom(
        typeof profile.displayName === "string" ? profile.displayName : ""
      ),
      source: "website",
      sourceDocId: doc.id,
    });
  }

  for (const doc of lumaSnap.docs) {
    const d = doc.data();
    const email = (d.email as string | undefined)?.trim().toLowerCase() ?? "";
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    if (judgeEmails.has(email) || declinedEmails.has(email)) {
      skippedJudgeOrDeclined++;
      continue;
    }
    if (unsubscribedEmails.has(email)) {
      skippedUnsubscribed++;
      continue;
    }
    if (seenEmails.has(email)) continue;
    const ghLogin = typeof d.githubLogin === "string" ? d.githubLogin : null;
    if (ghLogin && websiteGithubLogins.has(ghLogin.toLowerCase())) continue;
    if (!force && d[STAMP_FIELD]) {
      skippedAlreadyEmailed++;
      continue;
    }
    if (onlyEmail && email !== onlyEmail) {
      skippedOnlyEmailFilter++;
      continue;
    }
    seenEmails.add(email);
    recipients.push({
      email,
      firstName: firstNameFrom(typeof d.name === "string" ? d.name : ""),
      source: "luma",
      sourceDocId: doc.id,
    });
  }

  console.log(
    `\nRecipients: ${recipients.length}${onlyEmail ? ` (--only-email=${onlyEmail})` : ""}`
  );
  console.log(`Skipped — judge/declined:           ${skippedJudgeOrDeclined}`);
  console.log(`Skipped — unsubscribed:             ${skippedUnsubscribed}`);
  console.log(`Skipped — no email:                 ${skippedNoEmail}`);
  console.log(`Skipped — already emailed (stamp):  ${skippedAlreadyEmailed}`);
  if (onlyEmail) {
    console.log(`Skipped — --only-email filter:      ${skippedOnlyEmailFilter}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: no emails sent.\n");
    const sample = recipients[0];
    if (sample) {
      const { subject, html, text } = buildEmail(sample);
      console.log(`Sample to: ${sample.email} (${sample.source})`);
      console.log(`Subject: ${subject}`);
      console.log("\n--- HTML ---");
      console.log(html);
      console.log("\n--- Text ---");
      console.log(text);
    }
    console.log(`\nWould send to ${recipients.length} recipients.`);
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    const { subject, html, text } = buildEmail(r);
    try {
      await sendEmail({ to: r.email, subject, html, text });
      const collection =
        r.source === "website" ? "hackathonEventSignups" : "hackathonLumaRegistrants";
      await db
        .collection(collection)
        .doc(r.sourceDocId)
        .update({ [STAMP_FIELD]: FieldValue.serverTimestamp() })
        .catch((e) => {
          console.warn(`  [stamp-fail] ${r.email}`, e);
        });
      sent++;
      console.log(`  [ok] ${r.email}`);
      if (sent % 25 === 0) {
        console.log(`  Progress: ${sent}/${recipients.length}`);
      }
    } catch (e) {
      failed++;
      console.error(`  [fail] ${r.email}`, e);
    }
    await sleep(450);
  }

  console.log(`\nDone. Sent ${sent}, failed ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
