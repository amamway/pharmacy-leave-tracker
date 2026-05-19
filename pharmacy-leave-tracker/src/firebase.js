import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCkuxh37wtgawlhtWTD7MqP4owINzE8tG0",
  authDomain: "pharmacy-leave.firebaseapp.com",
  projectId: "pharmacy-leave",
  storageBucket: "pharmacy-leave.firebasestorage.app",
  messagingSenderId: "1026434938389",
  appId: "1:1026434938389:web:507cf8947466a8984ac01c",
  measurementId: "G-SRP6PDVT57"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
