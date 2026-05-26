#!/usr/bin/env node
/**
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Cursor Boston
 * This file is part of Cursor Boston, licensed under GPL-3.0.
 * See LICENSE file for details.
 */

/**
 * Sync Firebase Auth users into the `eventContacts` mailing list.
 *
 * For every Firebase Auth user with an email address, ensure a doc exists at
 * eventContacts/<lowercased-email>. Auth users who have no eventContacts doc
 * yet get a minimal placeholder created with `sources: ["firebase-auth"]` and
 * their `authUid` recorded, so future audits can tell auth-sourced rows from
 * Luma-sourced rows.
 *
 * Existing eventContacts docs are NEVER mutated. We only add what's missing.
 *
 * The user's prior unsubscribe choice (from the in-app `/users/<uid>.unsubscribed`
 * mirror) is honored — if the auth user already opted out, the new
 * eventContacts doc is created with `unsubscribed: true` so they stay out.
 *
 * Usage:
 *   npx tsx scripts/sync-auth-to-eventcontacts.ts --dry-run
 *   npx tsx scripts/sync-auth-to-eventcontacts.ts --commit
 *
 * Requires: FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "../lib/firebase-admin";

interface AuthUser {
  uid: string;
  email: string; // already lowercased + trimmed
  displayName: string | null;
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const commit = argv.includes("--commit");
  if ((dryRun && commit) || (!dryRun && !commit)) {
    console.error("Specify exactly one of: --dry-run | --commit");
    process.exit(1);
  }
  return { dryRun, commit };
}

async function listAllAuthUsers(): Promise<AuthUser[]> {
  const auth = getAdminAuth();
  if (!auth) {
    throw new Error("Firebase Admin Auth not configured");
  }
  const out: AuthUser[] = [];
  let pageToken: string | undefined;
  let page = 0;
  do {
    page++;
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      const rawEmail = u.email ?? "";
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes("@")) continue;
      out.push({
        uid: u.uid,
        email,
        displayName: u.displayName ?? null,
      });
    }
    pageToken = res.pageToken;
    console.log(`  auth page ${page}: cumulative=${out.length}`);
  } while (pageToken);
  return out;
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  const db = getAdminDb();
  if (!db) {
    console.error(
      "Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS)."
    );
    process.exit(1);
  }

  console.log("Listing Firebase Auth users…");
  const authUsers = await listAllAuthUsers();
  console.log(`Auth users with email: ${authUsers.length}`);

  console.log("Loading eventContacts emails…");
  const ecSnap = await db.collection("eventContacts").get();
  const ecEmails = new Set<string>();
  for (const doc of ecSnap.docs) {
    const data = doc.data();
    const email = (data.email || doc.id || "").toString().trim().toLowerCase();
    if (email) ecEmails.add(email);
  }
  console.log(`Existing eventContacts: ${ecEmails.size}`);

  console.log("Loading /users docs for unsubscribe-flag lookup…");
  const usersSnap = await db.collection("users").get();
  const unsubByEmail = new Map<string, boolean>();
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    const email = typeof d.email === "string" ? d.email.trim().toLowerCase() : "";
    if (!email) continue;
    if (d.unsubscribed === true) unsubByEmail.set(email, true);
  }
  console.log(`/users docs flagged unsubscribed: ${unsubByEmail.size}`);

  // Dedupe auth list by email (multiple auth records sharing one email is rare
  // but possible across providers). Keep the first uid seen; record duplicates.
  const seenAuthEmail = new Map<string, AuthUser>();
  let authDupes = 0;
  for (const u of authUsers) {
    if (seenAuthEmail.has(u.email)) {
      authDupes++;
      continue;
    }
    seenAuthEmail.set(u.email, u);
  }
  if (authDupes > 0) {
    console.log(`Auth duplicates by email (dropped): ${authDupes}`);
  }

  // Figure out who's missing from eventContacts.
  const toAdd: AuthUser[] = [];
  for (const u of seenAuthEmail.values()) {
    if (!ecEmails.has(u.email)) toAdd.push(u);
  }

  let wouldAddSubscribed = 0;
  let wouldAddUnsubscribed = 0;
  for (const u of toAdd) {
    if (unsubByEmail.get(u.email)) wouldAddUnsubscribed++;
    else wouldAddSubscribed++;
  }

  console.log("");
  console.log("=== Sync plan ===");
  console.log(`Auth users (unique by email):     ${seenAuthEmail.size}`);
  console.log(`Already in eventContacts:         ${seenAuthEmail.size - toAdd.length}`);
  console.log(`Would add (subscribed):           ${wouldAddSubscribed}`);
  console.log(`Would add (unsubscribed honored): ${wouldAddUnsubscribed}`);
  console.log(`Total would-add:                  ${toAdd.length}`);

  if (dryRun) {
    const sample = toAdd[0];
    if (sample) {
      console.log("");
      console.log("Sample doc that would be created:");
      console.log(JSON.stringify(buildContactDoc(sample, unsubByEmail.get(sample.email) === true), null, 2));
    }
    console.log("\n--dry-run: no writes made.");
    return;
  }

  if (toAdd.length === 0) {
    console.log("\nNothing to add. Done.");
    return;
  }

  console.log(`\nWriting ${toAdd.length} new eventContacts docs in batches of 400…`);
  let written = 0;
  for (let i = 0; i < toAdd.length; i += 400) {
    const slice = toAdd.slice(i, i + 400);
    const batch = db.batch();
    for (const u of slice) {
      const ref = db.collection("eventContacts").doc(u.email);
      const doc = buildContactDoc(u, unsubByEmail.get(u.email) === true);
      batch.set(ref, doc, { merge: false });
    }
    await batch.commit();
    written += slice.length;
    console.log(`  wrote ${written}/${toAdd.length}`);
  }
  console.log(`\nDone. Added ${written} eventContacts docs from Firebase Auth.`);
}

function buildContactDoc(u: AuthUser, unsubscribed: boolean) {
  const now = Timestamp.now();
  const nowIso = new Date().toISOString();
  const name = (u.displayName ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  const lastName = name.includes(" ")
    ? name.split(/\s+/).slice(1).join(" ")
    : "";
  return {
    email: u.email,
    name,
    firstName,
    lastName,
    events: [],
    eventNames: [],
    totalEvents: 0,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    updatedAt: now,
    sources: ["firebase-auth"],
    authUid: u.uid,
    ...(unsubscribed ? { unsubscribed: true } : {}),
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
