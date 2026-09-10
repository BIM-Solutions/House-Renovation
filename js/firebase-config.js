// Shared-sync configuration.
//
// Leave `firebaseConfig` as null and the app runs in LOCAL mode: everything is
// stored on this phone only. Fill it in (see README.md, "Turning on shared
// sync") and both of you see the same live data on every device.

export const firebaseConfig = null;

// Example of a filled-in config (copy the values from the Firebase console):
// export const firebaseConfig = {
//   apiKey: "AIza...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "1234567890",
//   appId: "1:1234567890:web:abcdef",
// };

// A single shared "household" that both of you write to. Any short id works,
// but it must match the id used in firestore.rules.
export const householdId = "home";

// Firebase JS SDK version loaded from Google's CDN when sync is enabled.
export const firebaseSdkVersion = "10.14.1";
