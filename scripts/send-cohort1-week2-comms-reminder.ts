#!/usr/bin/env node
/**
 * Copyright (C) 2026 Cursor Boston
 * This file is part of Cursor Boston, licensed under GPL-3.0.
 * See LICENSE file for details.
 */

/**
 * Thursday-before-deadline nudge to every admitted Cohort 1 applicant:
 * the Week 2 comms build PR is due Fri May 22 at 5pm EST. Encourage
 * folks to open a draft PR *now* to claim a slot on the
 * `c1w2comms-submission` branch, then push updates tomorrow when
 * they're done.
 *
 * Idempotent via `cohort1Week2CommsReminderEmailedAt`. `--force` re-sends.
 * `--only-email=foo@bar` restricts to a single recipient.
 *
 * Usage:
 *   npx tsx scripts/send-cohort1-week2-comms-reminder.ts --dry-run
 *   npx tsx scripts/send-cohort1-week2-comms-reminder.ts --send --only-email=roger@cursorboston.com
 *   npx tsx scripts/send-cohort1-week2-comms-reminder.ts --send
 *   npx tsx scripts/send-cohort1-week2-comms-reminder.ts --send --force
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase-admin";
import { sendEmail } from "../lib/mailgun";
import { buildUnsubscribeUrl, buildWithdrawUrl } from "../lib/unsubscribe-token";
import { SUMMER_COHORT_COLLECTION } from "../lib/summer-cohort";

const COHORT_URL = "https://cursorboston.com/summer-cohort";
const STAMP_FIELD = "cohort1Week2CommsReminderEmailedAt";

const SUBMISSION_BRANCH_URL =
  "https://github.com/rogerSuperBuilderAlpha/cursor-boston/tree/c1w2comms-submission";
const SUBMISSION_PATH =
  "content/summer-cohort/c1/w2-comms/submissions/<github-handle>.json";
const DEADLINE_LABEL = "Fri, May 22 · 5pm EST";
const VOTING_CALL_LABEL = "Fri, May 22 · 6pm EST";

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

  const subject = "Reminder: Week 2 comms build PR due tomorrow 5pm EST";

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#111;max-width:640px;">
<p>Hi ${first},</p>

<p>Quick reminder — the <strong>Week 2 comms build</strong> submission PR is due <strong>${escapeHtml(DEADLINE_LABEL)}</strong>. Voting call is right after at <strong>${escapeHtml(VOTING_CALL_LABEL)}</strong>.</p>

<p><strong>Pro move: open a draft PR <em>right now</em>.</strong> You don&apos;t need a finished submission to get on the branch — just open a PR into <a href="${escapeHtml(SUBMISSION_BRANCH_URL)}"><code>c1w2comms-submission</code></a> today with whatever you have (even a placeholder JSON), then push updates tomorrow as you finish. That way you&apos;re queued up, the branch knows you&apos;re shipping, and you don&apos;t have to race the deadline tomorrow afternoon.</p>

<div style="border:1px solid #d1d5db;border-radius:8px;padding:16px;margin:20px 0;background:#f9fafb;font-size:14px;color:#111;">
  <p style="margin:0 0 10px 0;"><strong>How to submit</strong></p>
  <p style="margin:0 0 6px 0;">
    Open a PR into <a href="${escapeHtml(SUBMISSION_BRANCH_URL)}"><code>c1w2comms-submission</code></a> with your submission JSON at:
  </p>
  <p style="margin:0 0 10px 0;">
    <code>${escapeHtml(SUBMISSION_PATH)}</code>
  </p>
  <p style="margin:0 0 6px 0;">
    Deadline: <strong>${escapeHtml(DEADLINE_LABEL)}</strong>
  </p>
  <p style="margin:0;">
    Voting call: <strong>${escapeHtml(VOTING_CALL_LABEL)}</strong>
  </p>
</div>

<p>
  <a href="${COHORT_URL}" style="display:inline-block;background:#0284c7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
    Open the cohort page →
  </a>
</p>

<p style="margin-top:8px;font-size:13px;color:#555;">
  Week 2 prompt, inspiration list, and submission form all live on the <strong>&quot;Week 2: Comms&quot;</strong> tab.
</p>

<p>Stuck? Reply to this email or ping in Discord — happy to look at what you&apos;ve got before you push.</p>

<p>— Roger<br/>
<a href="mailto:roger@cursorboston.com">roger@cursorboston.com</a></p>

<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
You&apos;re receiving this because you&apos;re admitted to Cohort 1 of the Cursor Boston summer cohort.<br/>
<a href="${escapeHtml(unsubUrl)}" style="color:#888;">Unsubscribe from emails</a> · <a href="${escapeHtml(withdrawUrl)}" style="color:#888;">Withdraw from Cohort 1</a>
</p>
</body></html>`;

  const text = `Hi ${firstText},

Quick reminder — the Week 2 comms build submission PR is due ${DEADLINE_LABEL}. Voting call is right after at ${VOTING_CALL_LABEL}.

PRO MOVE: OPEN A DRAFT PR RIGHT NOW.
You don't need a finished submission to get on the branch — just open a PR into c1w2comms-submission today with whatever you have (even a placeholder JSON), then push updates tomorrow as you finish. That way you're queued up, the branch knows you're shipping, and you don't have to race the deadline tomorrow afternoon.

HOW TO SUBMIT
  Open a PR into the c1w2comms-submission branch
  (${SUBMISSION_BRANCH_URL})
  with your submission JSON at:
    ${SUBMISSION_PATH}
  Deadline:     ${DEADLINE_LABEL}
  Voting call:  ${VOTING_CALL_LABEL}

Open the cohort page: ${COHORT_URL}
Week 2 prompt, inspiration list, and submission form all live on the "Week 2: Comms" tab.

Stuck? Reply to this email or ping in Discord — happy to look at what you've got before you push.

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
