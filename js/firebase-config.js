// Shared-sync configuration.
//
// Leave `firebaseConfig` as null and the app runs in LOCAL mode: everything is
// stored on this phone only. Fill it in (see README.md, "Turning on shared
// sync") and both of you see the same live data on every device.

export const firebaseConfig = {
  apiKey: "AIzaSyAVShWLBrk2QosOUpmMDbr_Cgg2_9a1GjM",
  authDomain: "house-renovate-cc25d.firebaseapp.com",
  projectId: "house-renovate-cc25d",
  storageBucket: "house-renovate-cc25d.firebasestorage.app",
  messagingSenderId: "501776550029",
  appId: "1:501776550029:web:2f813a9aae02366123bac4"
};

// A single shared "household" that both of you write to. Any short id works,
// but it must match the id used in firestore.rules.
export const householdId = "home";

// Firebase JS SDK version loaded from Google's CDN when sync is enabled.
export const firebaseSdkVersion = "10.14.1";
