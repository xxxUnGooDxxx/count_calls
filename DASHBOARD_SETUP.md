# Dashboard setup

1. In Firebase Authentication enable the **Email/Password** provider and create the allowed user.
2. Copy that user's UID. In Firestore create collection `dashboard_users` and an empty document whose ID is that UID. Repeat this only for people who may view the dashboard.
3. Firestore rules are stored in `firestore.rules` and deployed with `firebase deploy --only firestore:rules`.
4. In Firebase project settings create or select a Web App and copy its public configuration.
5. In Authentication settings add `xxxungoodxxx.github.io` to **Authorized domains**.
6. Add repository variables `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID`.
7. In GitHub open **Settings -> Pages** and choose **GitHub Actions** as the source.
8. Run the **Aggregate Number Scores** workflow manually once.

The dashboard address is `https://xxxungoodxxx.github.io/count_calls/`.

The page itself is static, but it contains no statistics. Firestore returns `dashboard_stats/current` only to an authenticated Firebase user.
