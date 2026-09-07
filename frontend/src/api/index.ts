// Adapter selection: the single `api` instance the app talks to.
//
// VITE_API_MOCK=true swaps in the in-memory mock so the UI runs (and can be
// demoed) without the backend. Everything else imports `api` from here and
// never decides for itself which transport it is on.

import type { Api } from "./client";
import { createHttpApi } from "./http";
import { createMockApi } from "./mock";

export const IS_MOCK = import.meta.env.VITE_API_MOCK === "true";

export const api: Api = IS_MOCK
  ? createMockApi()
  : createHttpApi(import.meta.env.VITE_API_BASE ?? "");

export type { Api } from "./client";
export { ApiError, errorMessage, isApiError } from "./client";
