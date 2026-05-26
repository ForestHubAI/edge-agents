/// <reference types="vite/client" />

// Pulls in Vite's ambient client types — including `declare module '*.css'`, which
// lets `import "...styles/index.css"` (and other asset side-effect imports) resolve
// without per-file declarations — plus `import.meta.env` typing. Standard Vite file.
