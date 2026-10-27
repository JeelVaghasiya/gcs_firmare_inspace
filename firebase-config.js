/* Firebase project used by the GCS upload and the public viewer.
 * Firebase console -> Project settings -> Your apps -> Web app -> Config.
 * These values identify the project; they are not secret. Write access is
 * controlled by the Realtime Database rules (see database.rules.json).
 * The GCS can override this from its 🔥 dialog (saved in that browser only). */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBD5gFn07sDou65IOKpWF4GaYOg9HFkdpM",
  authDomain: "inspace-f7015.firebaseapp.com",
  databaseURL: "https://inspace-f7015-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "inspace-f7015",
  storageBucket: "inspace-f7015.firebasestorage.app",
  messagingSenderId: "165221397818",
  appId: "1:165221397818:web:7f63b7ec0336418e728c03"
};
/* Must match "DATABASE PATH" in the GCS Firebase dialog */
window.FIREBASE_ROOT = "gcs/003";
