// src/lib/firebase.js
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Your Firebase configuration from Firebase Console
const firebaseConfig = {
  apiKey: "AIzaSyDbPHhOu776l5tp8qvXRJRZ7QY_R-DJKNA",
  authDomain: "fofo-4c356.firebaseapp.com",
  projectId: "fofo-4c356",
  storageBucket: "fofo-4c356.firebasestorage.app",
  messagingSenderId: "207618174282",
  appId: "1:207618174282:web:f3b60749313939aa3aa5b3"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Export Firebase services
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
export default app