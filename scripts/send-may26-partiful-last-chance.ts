#!/usr/bin/env node
/**
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Cursor Boston
 * This file is part of Cursor Boston, licensed under GPL-3.0.
 * See LICENSE file for details.
 */

/**
 * Last-chance push to RSVP on Partiful for the May 26 Hult event.
 *
 * Context: today is 2026-05-19. The Hult attendee list is submitted on
 * 2026-05-20, so this is the final ask before the door closes.
 *
 * Recipients: every `eventContacts` doc that isn't unsubscribed. After the
 * sync-auth-to-eventcontacts.ts run, this also covers Firebase Auth users
 * who had no prior Luma registration.
 *
 * Usage:
 *   npx tsx scripts/send-may26-partiful-last-chance.ts --dry-run
 *   npx tsx scripts/send-may26-partiful-last-chance.ts --send
 *
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS
 * For --send: MAILGUN_API_KEY, MAILGUN_DOMAIN
 *
 * Sender: this script sends as roger@cursorboston.com explicitly (passed
 * as `from` on every sendEmail call), independent of MAILGUN_FROM.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getAdminDb } from "../lib/firebase-admin";
import { sendEmail } from "../lib/mailgun";
import { syncMailgunSuppressions } from "../lib/mailgun-suppressions";
import { buildUnsubscribeUrl } from "../lib/unsubscribe-token";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ContactData {
  email: string;
  name: string;
  firstName: string;
}

const PARTIFUL_URL = "https://partiful.com/e/tuwaHOMgiJHvTfOFUJzA?c=EIywhmXE";
const HULT_CUTOFF_HUMAN = "tomorrow (Wednesday, May 20)";
const FROM_ADDRESS = "Roger <roger@cursorboston.com>";

function buildEmail(contact: ContactData): {
  subject: string;
  html: string;
  text: string;
} {
  const firstHtml = escapeHtml(
    contact.firstName?.trim() || contact.name?.split(" ")[0]?.trim() || "there"
  );
  const firstText =
    contact.firstName?.trim() || contact.name?.split(" ")[0]?.trim() || "there";
  const unsubUrl = buildUnsubscribeUrl(contact.email);

  const subject = `Last chance: RSVP on Partiful for May 26 — Hult list closes ${HULT_CUTOFF_HUMAN}`;

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.6;color:#111;max-width:640px;">
<p>Hi ${firstHtml},</p>

<p>Quick one: we submit the final attendee list to Hult <strong>${escapeHtml(HULT_CUTOFF_HUMAN)}</strong> for our May 26 event. If you want to be on it, please <strong>RSVP on Partiful now</strong>.</p>

<p style="margin-top:0;color:#555;">Tuesday <strong>May 26</strong> · Hult International, Cambridge · kicks off Boston Tech Week</p>

<p><a href="${PARTIFUL_URL}" style="display:inline-block;padding:12px 22px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">RSVP on Partiful →</a></p>

<p>Even if you already RSVP&apos;d on Luma or signed up on the website, please <strong>also RSVP on Partiful</strong> — Boston Tech Week only counts events that are on Partiful, and our Hult headcount is being pulled from the Partiful list.</p>

<p>And — please share the link. The bigger the RSVP count, the more visible Cursor Boston is during Tech Week:</p>

<p style="margin:8px 0;padding:8px 12px;background:#f5f5f5;border-radius:6px;font-family:ui-monospace,Menlo,monospace;font-size:13px;word-break:break-all;"><a href="${PARTIFUL_URL}">${PARTIFUL_URL}</a></p>

<p>Thanks — see you at Hult on the 26th.</p>

<p>— Roger &amp; Cursor Boston<br/>
<a href="mailto:roger@cursorboston.com">roger@cursorboston.com</a> · <a href="https://cursorboston.com">https://cursorboston.com</a></p>

<p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-size:12px;color:#888;">
You&apos;re receiving this because you signed up at cursorboston.com or registered for a Cursor Boston event.<br/>
Don&apos;t want to hear from us? <a href="${escapeHtml(unsubUrl)}" style="color:#888;">Unsubscribe</a>
</p>
</body></html>`;

  const text = `Hi ${firstText},

Quick one: we submit the final attendee list to Hult ${HULT_CUTOFF_HUMAN} for our May 26 event. If you want to be on it, please RSVP on Partiful now.

Tuesday May 26 · Hult International, Cambridge · kicks off Boston Tech Week

RSVP on Partiful:
→ ${PARTIFUL_URL}

Even if you already RSVP'd on Luma or signed up on the website, please also RSVP on Partiful — Boston Tech Week only counts events that are on Partiful, and our Hult headcount is being pulled from the Partiful list.

And — please share the link. The bigger the RSVP count, the more visible Cursor Boston is during Tech Week:

   ${PARTIFUL_URL}

Thanks — see you at Hult on the 26th.

— Roger & Cursor Boston
roger@cursorboston.com
https://cursorboston.com

---
You're receiving this because you signed up at cursorboston.com or registered for a Cursor Boston event.
Unsubscribe: ${unsubUrl}`;

  return { subject, html, text };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const send = args.includes("--send");

  if ((dryRun && send) || (!dryRun && !send)) {
    console.error("Specify exactly one of: --dry-run | --send");
    process.exit(1);
  }

  if (send) {
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      console.error("For --send, set MAILGUN_API_KEY and MAILGUN_DOMAIN.");
      process.exit(1);
    }
  }

  const db = getAdminDb();
  if (!db) {
    console.error(
      "Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS)."
    );
    process.exit(1);
  }

  if (send) await syncMailgunSuppressions(db);

  console.log("Loading contacts from eventContacts…");
  const snap = await db.collection("eventContacts").get();
  console.log(`Total contacts: ${snap.size}`);

  const contacts: ContactData[] = [];
  let skippedUnsubscribed = 0;
  let skippedNoEmail = 0;

  for (const doc of snap.docs) {
    const data = doc.data();

    if (data.unsubscribed === true) {
      skippedUnsubscribed++;
      continue;
    }
    const email = (data.email || doc.id || "").toString().trim();
    if (!email || !email.includes("@")) {
      skippedNoEmail++;
      continue;
    }

    contacts.push({
      email,
      name: data.name || "",
      firstName: data.firstName || "",
    });
  }

  console.log(
    `Eligible: ${contacts.length} | Skipped unsubscribed: ${skippedUnsubscribed} | Skipped no-email: ${skippedNoEmail}`
  );

  if (dryRun) {
    console.log("\n--dry-run: no emails sent.\n");
    const sample = contacts[0];
    if (sample) {
      const { subject, text } = buildEmail(sample);
      console.log(`Sample email to: ${sample.email}`);
      console.log(`Subject: ${subject}`);
      console.log(`\n---- TEXT preview ----\n${text}\n---- end TEXT ----\n`);
    }
    console.log(`\nWould send to ${contacts.length} contacts.`);
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const contact of contacts) {
    const { subject, html, text } = buildEmail(contact);
    try {
      await sendEmail({ from: FROM_ADDRESS, to: contact.email, subject, html, text });
      sent++;
      if (sent % 25 === 0) {
        console.log(`  Progress: ${sent}/${contacts.length}`);
      }
    } catch (e) {
      failed++;
      console.error(`Failed: ${contact.email}`, e);
    }
    await sleep(450);
  }

  console.log(
    `\nDone. Sent ${sent}, failed ${failed}, skipped ${skippedUnsubscribed + skippedNoEmail}.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
