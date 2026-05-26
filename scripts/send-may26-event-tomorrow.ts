#!/usr/bin/env node
/**
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Cursor Boston
 * This file is part of Cursor Boston, licensed under GPL-3.0.
 * See LICENSE file for details.
 */

/**
 * "Event is tomorrow" broadcast for the May 26 Sports Hack.
 *
 * Three audience segments, each gets a different dynamic block at the
 * top of the email; the logistics block underneath is identical for
 * everyone. The segment is derived from the live leaderboard snapshot:
 *
 *   - "confirmed"  — website signup + user-clicked Confirm Attendance
 *                    (Tier A under the three-tier ranking model). Copy:
 *                    "you're set, here's the logistics."
 *   - "claimed"    — website signup but no user-confirm yet (Tier B, OR
 *                    admin-checked-in-but-never-confirmed). Copy: "claim
 *                    is good, click Confirm Attendance now to lock in."
 *   - "external"   — no website signup, only on the Luma or Partiful
 *                    list (Tier C, or not in the snapshot at all). Copy:
 *                    "the website is the source of truth, sign up + claim
 *                    + confirm there before tomorrow morning."
 *
 * Logistics block (everyone gets this):
 *   - Arrive by 10am or earlier; 200-person venue, we WILL turn people away
 *   - EAT BEFORE YOU COME. We are NOT providing coffee or donuts in the
 *     morning. Pizzas show up in the afternoon for hackathon participants
 *     only. Water fountains throughout.
 *   - Bring your own laptop/charger; participate solo on infra
 *   - 1 Cursor credit per submission. Teams of up to 3 are fine but
 *     count as 1 submission = 1 credit code = 1 prize, all attributed
 *     to one Cursor account.
 *
 * Recipient set mirrors send-may26-confirm-attendance.ts / connect-fixed:
 * union of website signups + Luma-only minus judges/declined/unsubscribed,
 * deduped by email + matching GitHub login. Carries its own stamp
 * (`sportsHack2026EventTomorrowEmailedAt`) so it does NOT collide with
 * any prior broadcast.
 *
 * Usage:
 *   npx tsx scripts/send-may26-event-tomorrow.ts --dry-run
 *   npx tsx scripts/send-may26-event-tomorrow.ts --send --only-email=rhunt@bentley.edu
 *   npx tsx scripts/send-may26-event-tomorrow.ts --send
 *   npx tsx scripts/send-may26-event-tomorrow.ts --send --force
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
  SPORTS_HACK_2026_EVENT_ID,
  SPORTS_HACK_2026_NAME,
} from "../lib/sports-hack-2026";
import { getSnapshotOrRefresh } from "../lib/hackathon-leaderboard-snapshot";

const EVENT_ID = SPORTS_HACK_2026_EVENT_ID;
const STAMP_FIELD = "sportsHack2026EventTomorrowEmailedAt";

const SIGNUP_URL = `https://cursorboston.com/hackathons/${EVENT_ID}/signup`;
const FROM_ADDRESS = "Roger <roger@cursorboston.com>";

type Segment = "confirmed" | "claimed" | "external";

interface Recipient {
  email: string;
  firstName: string;
  source: "website" | "luma";
  sourceDocId: string;
  /** Lookup keys for the snapshot — used to derive the segment. */
  userId: string | null;
  githubLogin: string | null;
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

function buildEmail(
  r: Recipient,
  segment: Segment,
  myRank: number | null,
): {
  subject: string;
  html: string;
  text: string;
} {
  const first = escapeHtml(r.firstName?.trim() || "there");
  const firstText = r.firstName?.trim() || "there";
  const unsubUrl = buildUnsubscribeUrl(r.email);

  const subject =
    "Sports Hack TOMORROW — 10am at Hult, EAT before you come";

  // ---------------------------------------------------------------------------
  // Dynamic top block: status-aware "what to do right now".
  // ---------------------------------------------------------------------------
  const rankBadge =
    myRank != null
      ? `<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#10b981;color:#fff;font-weight:600;font-size:13px;margin-left:6px;">Rank #${myRank}</span>`
      : "";
  const rankBadgeText = myRank != null ? ` (rank #${myRank})` : "";

  let dynamicHtml = "";
  let dynamicText = "";

  if (segment === "confirmed") {
    dynamicHtml = `<div style="border:1px solid #10b981;border-radius:8px;padding:16px;margin:0 0 18px 0;background:#ecfdf5;color:#065f46;">
  <p style="margin:0 0 6px 0;"><strong>You&apos;re set.${rankBadge}</strong></p>
  <p style="margin:0;">You&apos;ve claimed your spot on the website AND clicked Confirm Attendance. You&apos;re on the door list — nothing more to do on the signup side. Just show up.</p>
</div>`;
    dynamicText = `YOU'RE SET${rankBadgeText}.
You've claimed your spot on the website AND clicked Confirm Attendance. You're on the door list — nothing more to do on the signup side. Just show up.

`;
  } else if (segment === "claimed") {
    dynamicHtml = `<div style="border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:0 0 18px 0;background:#fffbeb;color:#78350f;">
  <p style="margin:0 0 6px 0;"><strong>One more step — click Confirm Attendance.${rankBadge}</strong></p>
  <p style="margin:0;">You&apos;ve claimed your spot on the website but you haven&apos;t clicked Confirm Attendance yet. The door list pulls from confirmed-only. Take 10 seconds and confirm now so you don&apos;t get bounced.</p>
  <p style="margin:10px 0 0 0;"><a href="${SIGNUP_URL}" style="display:inline-block;padding:10px 18px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Confirm attendance →</a></p>
</div>`;
    dynamicText = `ONE MORE STEP — CLICK CONFIRM ATTENDANCE${rankBadgeText}.
You've claimed your spot on the website but you haven't clicked Confirm Attendance yet. The door list pulls from confirmed-only. Take 10 seconds and confirm now so you don't get bounced.

  ${SIGNUP_URL}

`;
  } else {
    dynamicHtml = `<div style="border:1px solid #ef4444;border-radius:8px;padding:16px;margin:0 0 18px 0;background:#fef2f2;color:#7f1d1d;">
  <p style="margin:0 0 6px 0;"><strong>You&apos;re NOT on the website list.</strong></p>
  <p style="margin:0;">A Luma or Partiful RSVP is an interest signal — it doesn&apos;t reserve a seat. The website signup is the door list. Sign in (or create an account), claim a spot, and click Confirm Attendance — three quick clicks total.</p>
  <p style="margin:10px 0 0 0;"><a href="${SIGNUP_URL}" style="display:inline-block;padding:10px 18px;background:#ef4444;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Sign up on the website →</a></p>
</div>`;
    dynamicText = `YOU'RE NOT ON THE WEBSITE LIST.
A Luma or Partiful RSVP is an interest signal — it doesn't reserve a seat. The website signup is the door list. Sign in (or create an account), claim a spot, and click Confirm Attendance — three quick clicks total.

  ${SIGNUP_URL}

`;
  }

  // ---------------------------------------------------------------------------
  // Shared logistics block.
  // ---------------------------------------------------------------------------
  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#111;max-width:640px;">
<p>Hi ${first},</p>

<p>Tomorrow is <strong>${escapeHtml(SPORTS_HACK_2026_NAME)}</strong> — Tuesday, May 26, at Hult International, Cambridge. A few critical logistics. Please read all the way through.</p>

${dynamicHtml}

<h3 style="margin-top:22px;margin-bottom:10px;">Logistics</h3>

<ul style="padding-left:20px;">
  <li style="margin-bottom:10px;"><strong>Get there by 10am.</strong> Earlier is better. We have <strong>200 spots</strong> in the venue and we <strong>will</strong> turn people away once we&apos;re full. Don&apos;t cut it close.</li>
  <li style="margin-bottom:10px;">
    <strong style="color:#b91c1c;">EAT BEFORE YOU COME.</strong> We are <strong>not</strong> providing coffee or donuts in the morning. Hit a Dunkin, grab a bagel, get a coffee — whatever you need. There are water fountains throughout the building, but solid food is on you for the first half of the day.
  </li>
  <li style="margin-bottom:10px;"><strong>Pizza in the afternoon</strong> — for hackathon participants only.</li>
  <li style="margin-bottom:10px;"><strong>Bring your own kit.</strong> Laptop, charger, whatever you need to build. You&apos;ll be participating in the hackathon on your own infrastructure — no shared machines.</li>
  <li style="margin-bottom:10px;"><strong>One credit code per submission.</strong> You can build as a team of up to 3, but each submission counts as one entry: <strong>one Cursor credit code + one prize</strong>, attributed to a single Cursor account. Decide upfront whose account it goes to.</li>
</ul>

<div style="border:2px solid #b91c1c;border-radius:8px;padding:14px;margin:20px 0;background:#fef2f2;color:#7f1d1d;text-align:center;">
  <p style="margin:0;font-size:18px;font-weight:700;">EAT SOMETHING IN THE MORNING.</p>
  <p style="margin:6px 0 0 0;font-size:14px;">There&apos;s no food at the venue until the afternoon. Plan accordingly.</p>
</div>

<p>See you at Hult.</p>

<p>— Roger<br/>
<a href="mailto:roger@cursorboston.com">roger@cursorboston.com</a></p>

<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
You&apos;re receiving this because you registered for the Cursor Boston May 26 event on Luma, Partiful, or the website.<br/>
<a href="${escapeHtml(unsubUrl)}" style="color:#888;">Unsubscribe from emails</a>
</p>
</body></html>`;

  const text = `Hi ${firstText},

Tomorrow is ${SPORTS_HACK_2026_NAME} — Tuesday, May 26, at Hult International, Cambridge. A few critical logistics. Please read all the way through.

${dynamicText}LOGISTICS

  - GET THERE BY 10AM. Earlier is better. We have 200 spots in the
    venue and we WILL turn people away once we're full. Don't cut it
    close.

  - EAT BEFORE YOU COME. We are NOT providing coffee or donuts in the
    morning. Hit a Dunkin, grab a bagel, get a coffee — whatever you
    need. There are water fountains throughout the building, but solid
    food is on you for the first half of the day.

  - Pizza in the afternoon — for hackathon participants only.

  - Bring your own kit. Laptop, charger, whatever you need to build.
    You'll be participating in the hackathon on your own infrastructure
    — no shared machines.

  - One credit code per submission. You can build as a team of up to
    3, but each submission counts as one entry: ONE Cursor credit code
    + ONE prize, attributed to a single Cursor account. Decide upfront
    whose account it goes to.

⚠️ EAT SOMETHING IN THE MORNING.
There's no food at the venue until the afternoon. Plan accordingly.

See you at Hult.

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

  // ---------------------------------------------------------------------------
  // Snapshot — for per-recipient segment derivation.
  // ---------------------------------------------------------------------------
  console.log("Reading leaderboard snapshot for segmentation…");
  const snapshot = await getSnapshotOrRefresh(EVENT_ID);
  const entryByUserId = new Map<string, (typeof snapshot.entries)[number]>();
  const entryByGhLogin = new Map<string, (typeof snapshot.entries)[number]>();
  for (const e of snapshot.entries) {
    if (e.userId) entryByUserId.set(e.userId, e);
    if (e.githubLogin) entryByGhLogin.set(e.githubLogin.toLowerCase(), e);
  }
  console.log(`Snapshot has ${snapshot.entries.length} entries.`);

  // ---------------------------------------------------------------------------
  // Audience pull — identical to the prior broadcasts so segments and stamps
  // line up cleanly.
  // ---------------------------------------------------------------------------
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
  console.log(`Luma+Partiful registrants (${EVENT_ID}): ${lumaSnap.size}`);

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
        typeof profile.displayName === "string" ? profile.displayName : "",
      ),
      source: "website",
      sourceDocId: doc.id,
      userId,
      githubLogin: ghLogin,
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
      userId: null,
      githubLogin: ghLogin,
    });
  }

  // ---------------------------------------------------------------------------
  // Segment each recipient using the snapshot. Counts go to the dry-run
  // log so a maintainer can sanity-check the bucketing before --send.
  // ---------------------------------------------------------------------------
  const segments = new Map<string, Segment>();
  const ranks = new Map<string, number | null>();
  let countConfirmed = 0;
  let countClaimed = 0;
  let countExternal = 0;
  for (const r of recipients) {
    const entry =
      (r.userId && entryByUserId.get(r.userId)) ||
      (r.githubLogin && entryByGhLogin.get(r.githubLogin.toLowerCase())) ||
      null;
    let seg: Segment;
    if (entry?.tier === "A") {
      seg = "confirmed";
      countConfirmed++;
    } else if (entry && entry.userId != null) {
      // entry exists with a website signup but not Tier A — Tier B or
      // freeze-model "not confirmed". Either way: needs the click.
      seg = "claimed";
      countClaimed++;
    } else {
      // No matching website-signup snapshot row → Tier C / external-only.
      seg = "external";
      countExternal++;
    }
    segments.set(r.email, seg);
    ranks.set(r.email, entry?.rank ?? null);
  }

  console.log(
    `\nRecipients: ${recipients.length}${onlyEmail ? ` (--only-email=${onlyEmail})` : ""}`,
  );
  console.log(
    `  Segment: confirmed (Tier A):           ${countConfirmed}`,
  );
  console.log(`  Segment: claimed-not-confirmed (Tier B): ${countClaimed}`);
  console.log(`  Segment: external-only (Luma/Partiful):  ${countExternal}`);
  console.log(`Skipped — judge/declined:           ${skippedJudgeOrDeclined}`);
  console.log(`Skipped — unsubscribed:             ${skippedUnsubscribed}`);
  console.log(`Skipped — no email:                 ${skippedNoEmail}`);
  console.log(`Skipped — already emailed (stamp):  ${skippedAlreadyEmailed}`);
  if (onlyEmail) {
    console.log(`Skipped — --only-email filter:      ${skippedOnlyEmailFilter}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: no emails sent.\n");
    // Show a sample for each segment so a maintainer can eyeball all three
    // copy variants in one pass.
    const samples: Array<{ seg: Segment; recipient: Recipient }> = [];
    for (const seg of ["confirmed", "claimed", "external"] as const) {
      const found = recipients.find((r) => segments.get(r.email) === seg);
      if (found) samples.push({ seg, recipient: found });
    }
    for (const { seg, recipient } of samples) {
      const { subject, text } = buildEmail(
        recipient,
        seg,
        ranks.get(recipient.email) ?? null,
      );
      console.log(
        `\n=== Sample for segment "${seg}" → ${recipient.email} ===`,
      );
      console.log(`Subject: ${subject}`);
      console.log("--- Text ---");
      console.log(text);
    }
    console.log(`\nWould send to ${recipients.length} recipients.`);
    return;
  }

  let sent = 0;
  let failed = 0;
  for (const r of recipients) {
    const seg = segments.get(r.email) ?? "external";
    const myRank = ranks.get(r.email) ?? null;
    const { subject, html, text } = buildEmail(r, seg, myRank);
    try {
      await sendEmail({
        from: FROM_ADDRESS,
        to: r.email,
        subject,
        html,
        text,
      });
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
      console.log(`  [ok] ${seg.padEnd(10)} ${r.email}`);
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
