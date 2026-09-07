// Ambient type declarations for Vite: `import.meta.env`, asset imports, etc.
// Also declares the project-specific env variables read in src/api/index.ts.
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" to run the UI against the in-memory mock adapter (no backend). */
  readonly VITE_API_MOCK?: string;
  /** Optional absolute base URL for the API; defaults to same-origin "". */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
