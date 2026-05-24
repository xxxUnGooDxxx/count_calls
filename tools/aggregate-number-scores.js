'use strict';

const admin = require('firebase-admin');

const CATEGORIES = ['spam', 'collector', 'robot', 'fraud'];
const MIN_COMPLAINTS = 5;

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

async function aggregate(db, groups) {
  const scoresCol = db.collection('number_scores');
  const batch = db.batch();
  let written = 0;
  let skipped = 0;

  for (const [phoneHash, entry] of groups) {
    const complaintCount = entry.installations.size;

    if (complaintCount < MIN_COMPLAINTS) {
      skipped++;
      continue;
    }

    const docRef = scoresCol.doc(phoneHash);
    batch.set(
      docRef,
      {
        phoneHash,
        phoneTail: entry.phoneTail,
        complaintCount,
        topCategory: topCategory(entry.categoryCounts),
        status: 'has_complaints',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    written++;
  }

  await batch.commit();
  return { written, skipped };
}

async function main() {
  initFirebase();
  const db = admin.firestore();

  console.log('Reading number_reports...');
  const reports = await readAllReports(db);
  console.log(`Loaded ${reports.length} report(s)`);

  const groups = groupByPhoneHash(reports);
  console.log(`Unique phoneHash entries: ${groups.size}`);

  const { written, skipped } = await aggregate(db, groups);
  console.log(`Done. Written: ${written}, skipped (< ${MIN_COMPLAINTS} complaints): ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
