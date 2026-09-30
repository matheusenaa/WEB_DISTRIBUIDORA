/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL base da API. Vazio = mesma origem (recomendado com proxy do Vite). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}