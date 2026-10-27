// Firebase Auth for the browser extension (web/build.mjs swaps it in for 'firebase/auth').
// The web-extension build has no browserLocalPersistence; sync.js lists it after IndexedDB as
// a fallback, so in-memory stands in for it here.
export * from 'firebase/auth/web-extension';
export { inMemoryPersistence as browserLocalPersistence } from 'firebase/auth/web-extension';
