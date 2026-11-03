/**
 * API types. crm-be imports this file as `@shared/types`.
 */

/** The response body of `GET /api/health`. */
export interface HealthResponse {
  ok: true;
}

/** The response body of a failed API request. */
export interface ApiError {
  error: string;
}

/** The request body of `POST /api/passkeys/register`. */
export interface PasskeyRegisterRequest {
  name: string;
  /** The `RegistrationResponseJSON` from `startRegistration()`. */
  response: unknown;
  /** The path to open after the passkey is added. */
  next?: string;
}

/** The response body of `POST /api/passkeys/register`. */
export interface PasskeyRegisterResponse {
  /** The path to open now. */
  next: string;
}

/** The request body of `POST /api/passkeys/sign-in`. */
export interface PasskeySignInRequest {
  /** The `AuthenticationResponseJSON` from `startAuthentication()`. */
  response: unknown;
  /** The path to open after the sign-in. */
  next?: string;
}

/** The response body of `POST /api/passkeys/sign-in`. */
export interface PasskeySignInResponse {
  /** The path to open now. */
  next: string;
}
