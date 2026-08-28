# XOX Arena

Small React + Firebase Tic-Tac-Toe game.

## Features
- Play instantly as a guest.
- Pro/unbeatable minimax bot.
- Online rooms with 6-character codes.
- Invite links.
- Firebase player stats + leaderboard.
- Google account linking for saving a guest profile.

## Setup
1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Put your Firebase Web App configuration into `.env`.
4. Enable **Anonymous** and **Google** sign-in in Firebase Authentication.
5. Create Firestore Database.
6. Apply `firebase/firestore.rules`.
7. Run `npm run dev` or build with `npm run build`.

## Deploy
Push the project to GitHub and connect the repository to Vercel/Netlify. Add the same `VITE_FIREBASE_*` environment variables in the hosting dashboard.

## Notes
The app intentionally keeps the codebase small. For a public production launch, tighten Firestore rules further with server-side validation/Cloud Functions so clients cannot forge match results or stats.