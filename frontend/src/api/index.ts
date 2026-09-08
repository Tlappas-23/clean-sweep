// Adapter selection: the single `api` instance the app talks to.
//
// VITE_API_MOCK=true swaps in the in-memory mock so the UI runs (and can be
// demoed) without the backend. Everything else imports `api` from here and
// never decides for itself which transport it is on.
//
// The deployed site runs against the real API, not the mock: `VITE_API_BASE`
// points at it and the mock is left for local UI work and the tests. That is
// the difference between playing on a few dozen fixture films and playing on
// the whole catalogue.

import type { Api } from "./client";
import { createHttpApi, onWaking as httpOnWaking } from "./http";
import { createMockApi } from "./mock";

export const IS_MOCK = import.meta.env.VITE_API_MOCK === "true";

export const api: Api = IS_MOCK
  ? createMockApi()
  : createHttpApi(import.meta.env.VITE_API_BASE ?? "");

export type { Api } from "./client";
export { ApiError, errorMessage, isApiError } from "./client";

/**
 * Subscribe to "the server is waking up".
 *
 * Only the real transport can be asleep, so the mock exports a no-op. That
 * keeps every screen free of `if (IS_MOCK)`: they subscribe unconditionally
 * and simply never hear anything in mock mode.
 */
export const onWaking: (listener: ((waking: boolean) => void) | null) => void = IS_MOCK
  ? () => {}
  : httpOnWaking;
