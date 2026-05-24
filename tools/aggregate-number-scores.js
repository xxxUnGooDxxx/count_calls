'use strict';

const admin = require('firebase-admin');

const CATEGORIES = ['spam', 'collector', 'robot', 'fraud'];
const THRESHOLD = 5;

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
  let hasComplaints = 0;
  let notEnough = 0;

  for (const [phoneHash, entry] of groups) {
    const complaintCount = entry.installations.size;
    const status = complaintCount >= THRESHOLD ? 'has_complaints' : 'not_enough_reports';

    if (status === 'has_complaints') {
      hasComplaints++;
    } else {
      notEnough++;
    }

    const docRef = scoresCol.doc(phoneHash);
    batch.set(
      docRef,
      {
        phoneHash,
        phoneTail: entry.phoneTail,
        complaintCount,
        topCategory: topCategory(entry.categoryCounts),
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  return { written: hasComplaints + notEnough, hasComplaints, notEnough };
}

async function main() {
  initFirebase();
  const db = admin.firestore();

  console.log('Reading number_reports...');
  const reports = await readAllReports(db);
  console.log(`Loaded ${reports.length} report(s)`);

  const groups = groupByPhoneHash(reports);
  console.log(`Unique phoneHash entries: ${groups.size}`);

  const { written, hasComplaints, notEnough } = await aggregate(db, groups);
  console.log(`Done.`);
  console.log(`  number_scores updated : ${written}`);
  console.log(`  status has_complaints : ${hasComplaints}`);
  console.log(`  status not_enough_reports : ${notEnough}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
