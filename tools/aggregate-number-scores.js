'use strict';

const admin = require('firebase-admin');

const CATEGORIES = ['spam', 'collector', 'robot', 'fraud'];
const THRESHOLD = 5;
const BATCH_LIMIT = 500;

function initFirebase() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set');
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function readAllReports(db) {
  const snapshot = await db.collection('number_reports').get();
  return snapshot.docs.map((doc) => doc.data());
}

function groupByPhoneHash(reports) {
  const groups = new Map();

  for (const report of reports) {
    const { phoneHash, phoneTail, installationId, category } = report;
    if (!phoneHash || !installationId) continue;

    if (!groups.has(phoneHash)) {
      groups.set(phoneHash, {
        phoneHash,
        phoneTail: phoneTail || '',
        installations: new Set(),
        categoryCounts: {},
      });
    }

    const entry = groups.get(phoneHash);
    entry.installations.add(installationId);

    if (category && CATEGORIES.includes(category)) {
      entry.categoryCounts[category] = (entry.categoryCounts[category] || 0) + 1;
    }
  }

  return groups;
}

function topCategory(categoryCounts) {
  let best = null;
  let bestCount = 0;
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > bestCount) {
      bestCount = count;
      best = cat;
    }
  }
  return best;
}

function scoreData(phoneHash, entry) {
  const complaintCount = entry.installations.size;
  return {
    phoneHash,
    phoneTail: entry.phoneTail,
    complaintCount,
    topCategory: topCategory(entry.categoryCounts),
    status: complaintCount >= THRESHOLD ? 'has_complaints' : 'not_enough_reports',
  };
}

function scoreChanged(current, next) {
  return !current || Object.entries(next).some(([key, value]) => current[key] !== value);
}

async function readCurrentScores(scoresCol) {
  const snapshot = await scoresCol.get();
  return new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
}

async function commitChanges(db, changes) {
  for (let offset = 0; offset < changes.length; offset += BATCH_LIMIT) {
    const batch = db.batch();
    for (const { docRef, data } of changes.slice(offset, offset + BATCH_LIMIT)) {
      batch.set(
        docRef,
        { ...data, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

async function aggregate(db, groups) {
  const scoresCol = db.collection('number_scores');
  const currentScores = await readCurrentScores(scoresCol);
  const changes = [];
  let hasComplaints = 0;
  let notEnough = 0;

  for (const [phoneHash, entry] of groups) {
    const data = scoreData(phoneHash, entry);

    if (data.status === 'has_complaints') {
      hasComplaints++;
    } else {
      notEnough++;
    }

    if (scoreChanged(currentScores.get(phoneHash), data)) {
      changes.push({ docRef: scoresCol.doc(phoneHash), data });
    }
  }

  await commitChanges(db, changes);
  return {
    written: changes.length,
    unchanged: groups.size - changes.length,
    hasComplaints,
    notEnough,
  };
}

function isFirestoreQuotaError(err) {
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || '').toLowerCase();
  return code === '8' ||
    code === 'resource-exhausted' ||
    code === 'firestore/resource-exhausted' ||
    message.includes('quota exceeded') ||
    message.includes('resource exhausted');
}

async function main() {
  initFirebase();
  const db = admin.firestore();

  console.log('Reading number_reports...');
  const reports = await readAllReports(db);
  console.log(`Loaded ${reports.length} report(s)`);

  const groups = groupByPhoneHash(reports);
  console.log(`Unique phoneHash entries: ${groups.size}`);

  const { written, unchanged, hasComplaints, notEnough } = await aggregate(db, groups);
  console.log('Done.');
  console.log(`  number_scores written : ${written}`);
  console.log(`  number_scores unchanged : ${unchanged}`);
  console.log(`  status has_complaints : ${hasComplaints}`);
  console.log(`  status not_enough_reports : ${notEnough}`);
}

main().catch((err) => {
  if (isFirestoreQuotaError(err)) {
    console.warn('Firestore quota is exhausted; skipping this run without failing the workflow.');
    console.warn(err.message || err);
    return;
  }
  console.error(err);
  process.exit(1);
});
