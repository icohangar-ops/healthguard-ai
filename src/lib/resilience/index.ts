// Vendored from cubiczan-resilience (TypeScript flavor):
// github.com/icohangar-ops/cubiczan-resilience  (typescript/src)
// No npm registry — copied in-tree so external calls and auth boundaries are
// hardened with the audited safeFetch / requireAuth / retry primitives.
export {
  ResilienceError,
  isResilienceError,
  type ResilienceErrorKind,
  type ResilienceErrorOptions,
} from "./errors";

export { withTimeout } from "./timeout";

export { retry, computeBackoff, type RetryOptions } from "./retry";

export {
  safeFetch,
  type SafeFetchOptions,
  type AllowlistHook,
} from "./safeFetch";

export {
  SlidingWindowRateLimiter,
  type RateLimitOptions,
  type RateLimitResult,
} from "./rateLimit";

export {
  requireAuth,
  requireAuthResponse,
  type AuthResult,
  type RequireAuthOptions,
} from "./auth";
