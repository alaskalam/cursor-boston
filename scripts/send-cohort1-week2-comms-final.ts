#!/usr/bin/env node
/**
 * Copyright (C) 2026 Cursor Boston
 * This file is part of Cursor Boston, licensed under GPL-3.0.
 * See LICENSE file for details.
 */

/**
 * Final-call nudge on deadline day (Fri May 22, 2026) to every admitted
 * Cohort 1 applicant: Week 2 comms submission PR closes at 5pm EST,
 * and the voting / show-and-tell Zoom kicks off at 6pm. Emphasizes both
 * the last-chance draft PR and showing up at 6pm regardless of submission
 * status.
 *
 * Idempotent via `cohort1Week2CommsFinalEmailedAt`. `--force` re-sends.
 * `--only-email=foo@bar` restricts to a single recipient.
 *
 * Usage:
 *   npx tsx scripts/send-cohort1-week2-comms-final.ts --dry-run
 *   npx tsx scripts/send-cohort1-week2-comms-final.ts --send --only-email=roger@cursorboston.com
 *   npx tsx scripts/send-cohort1-week2-comms-final.ts --send
 *   npx tsx scripts/send-cohort1-week2-comms-final.ts --send --force
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase-admin";
import { sendEmail } from "../lib/mailgun";
import { buildUnsubscribeUrl, buildWithdrawUrl } from "../lib/unsubscribe-token";
import { SUMMER_COHORT_COLLECTION } from "../lib/summer-cohort";

const COHORT_URL = "https://cursorboston.com/summer-cohort";
const STAMP_FIELD = "cohort1Week2CommsFinalEmailedAt";

const SUBMISSION_BRANCH_URL =
  "https://github.com/rogerSuperBuilderAlpha/cursor-boston/tree/c1w2comms-submission";
const DEADLINE_LABEL = "5:00 pm EST — right now";
const VOTING_CALL_LABEL = "Tonight · 6:00 pm EST";

const ZOOM_URL = "https://bentley.zoom.us/j/93113089218";
const ZOOM_CHAT_URL = "https://bentley.zoom.us/launch/jc/93113089218";
const ZOOM_MEETING_ID = "931 1308 9218";
const ZOOM_ONE_TAP_1 = "+13017158592,,93113089218# US (Washington DC)";
const ZOOM_ONE_TAP_2 = "+13052241968,,93113089218# US";

interface Recipient {
  applicationId: string;
  email: string;
  firstName: string;
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
  const withdrawUrl = buildWithdrawUrl(r.email, "cohort-1");

  const subject = "Final call — deadline now, Zoom at 6pm";

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#111;max-width:640px;">
<p>Hi ${first},</p>

<p><strong>This is it — the Week 2 deadline is at ${escapeHtml(DEADLINE_LABEL)}.</strong> If you have anything to submit, open a draft PR against <a href="${escapeHtml(SUBMISSION_BRANCH_URL)}"><code>c1w2comms-submission</code></a> in the next few minutes. Placeholder JSON is fine — getting on the branch is what counts. You can keep pushing commits up to 5:00 pm sharp.</p>

<p><strong>Whether you submitted or not — see you at 6pm.</strong> That&apos;s the whole point. We walk through every build, hear the pitches live, and vote on Week 2. The room is way better when everyone shows up, including folks who didn&apos;t ship this week.</p>

<div style="border:2px solid #0284c7;border-radius:8px;padding:16px;margin:20px 0;background:#f0f9ff;font-size:14px;color:#111;">
  <p style="margin:0 0 10px 0;font-size:16px;"><strong>Zoom — tonight, 6:00 pm EST</strong></p>
  <p style="margin:0 0 6px 0;">
    Join: <a href="${escapeHtml(ZOOM_URL)}">${escapeHtml(ZOOM_URL)}</a>
  </p>
  <p style="margin:0 0 6px 0;">
    Meeting chat: <a href="${escapeHtml(ZOOM_CHAT_URL)}">${escapeHtml(ZOOM_CHAT_URL)}</a>
  </p>
  <p style="margin:0 0 6px 0;">
    Meeting ID: <strong>${ZOOM_MEETING_ID}</strong>
  </p>
  <p style="margin:0;color:#555;font-size:13px;">
    One-tap mobile: ${escapeHtml(ZOOM_ONE_TAP_1)} · ${escapeHtml(ZOOM_ONE_TAP_2)}
  </p>
</div>

<p>
  <a href="${ZOOM_URL}" style="display:inline-block;background:#0284c7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
    Join the 6pm Zoom →
  </a>
</p>

<p>See you in a bit.</p>

<p>— Roger<br/>
<a href="mailto:roger@cursorboston.com">roger@cursorboston.com</a></p>

<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
You&apos;re receiving this because you&apos;re admitted to Cohort 1 of the Cursor Boston summer cohort.<br/>
<a href="${escapeHtml(unsubUrl)}" style="color:#888;">Unsubscribe from emails</a> · <a href="${escapeHtml(withdrawUrl)}" style="color:#888;">Withdraw from Cohort 1</a>
</p>
</body></html>`;

  const text = `Hi ${firstText},

This is it — the Week 2 deadline is at ${DEADLINE_LABEL}. If you have anything to submit, open a draft PR against c1w2comms-submission in the next few minutes. Placeholder JSON is fine — getting on the branch is what counts. You can keep pushing commits up to 5:00 pm sharp.

(${SUBMISSION_BRANCH_URL})

WHETHER YOU SUBMITTED OR NOT — SEE YOU AT 6PM. That's the whole point. We walk through every build, hear the pitches live, and vote on Week 2. The room is way better when everyone shows up, including folks who didn't ship this week.

ZOOM — TONIGHT, ${VOTING_CALL_LABEL}
  Join: ${ZOOM_URL}
  Meeting chat: ${ZOOM_CHAT_URL}
  Meeting ID: ${ZOOM_MEETING_ID}
  One-tap mobile: ${ZOOM_ONE_TAP_1} · ${ZOOM_ONE_TAP_2}

Open the cohort page: ${COHORT_URL}

See you in a bit.

— Roger
roger@cursorboston.com

---
You're receiving this because you're admitted to Cohort 1 of the Cursor Boston summer cohort.
Unsubscribe from emails: ${unsubUrl}
Withdraw from Cohort 1:  ${withdrawUrl}
`;

  return { subject, html, text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const send = process.argv.includes("--send");
  const force = process.argv.includes("--force");
  const onlyEmail = getOnlyEmailFlag();
  if (!dryRun && !send) {
    console.error("Pass --dry-run or --send.");
    process.exit(1);
  }

  const db = getAdminDb();
  if (!db) {
    console.error("Firebase Admin not configured.");
    process.exit(1);
  }

  const appsSnap = await db.collection(SUMMER_COHORT_COLLECTION).get();

  const recipients: Recipient[] = [];
  let skippedNotCohort1 = 0;
  let skippedNotAdmitted = 0;
  let skippedAlreadyEmailed = 0;
  let skippedNoEmail = 0;
  let skippedOnlyEmailFilter = 0;

  for (const appDoc of appsSnap.docs) {
    const d = appDoc.data() as {
      cohorts?: string[];
      status?: string;
      email?: string;
      name?: string;
      [STAMP_FIELD]?: unknown;
    };
    const cohorts = Array.isArray(d.cohorts) ? d.cohorts : [];
    if (!cohorts.includes("cohort-1")) {
      skippedNotCohort1++;
      continue;
    }
    if (d.status !== "admitted") {
      skippedNotAdmitted++;
      continue;
    }
    if (!d.email) {
      skippedNoEmail++;
      continue;
    }
    if (!force && d[STAMP_FIELD]) {
      skippedAlreadyEmailed++;
      continue;
    }
    if (onlyEmail && d.email.trim().toLowerCase() !== onlyEmail) {
      skippedOnlyEmailFilter++;
      continue;
    }
    const name = d.name?.trim() || "";
    const firstName = name.split(" ")[0] || "";
    recipients.push({
      applicationId: appDoc.id,
      email: d.email.trim(),
      firstName,
    });
  }

  console.log(
    `Eligible recipients (admitted cohort-1${onlyEmail ? `, --only-email=${onlyEmail}` : ""}, not yet emailed): ${recipients.length}`
  );
  console.log(`Skipped — not cohort-1: ${skippedNotCohort1}`);
  console.log(`Skipped — not admitted: ${skippedNotAdmitted}`);
  console.log(`Skipped — no email: ${skippedNoEmail}`);
  console.log(`Skipped — already emailed (${STAMP_FIELD}): ${skippedAlreadyEmailed}`);
  if (onlyEmail) {
    console.log(`Skipped — --only-email filter: ${skippedOnlyEmailFilter}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: no emails sent.\n");
    const sample = recipients[0];
    if (sample) {
      const { subject, html, text } = buildEmail(sample);
      console.log(`Sample to: ${sample.email}`);
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
      await db
        .collection(SUMMER_COHORT_COLLECTION)
        .doc(r.applicationId)
        .update({ [STAMP_FIELD]: FieldValue.serverTimestamp() });
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
