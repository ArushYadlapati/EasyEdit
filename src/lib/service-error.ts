import type { OpErrorCode } from "@/lib/timeline";

export type ErrorBody = { code: string; message: string; opIndex?: number; currentVersion?: number; missing?: string[] };

export type ServiceErrorCode =
  | OpErrorCode
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STORAGE_IN_USE"
  | "ACCOUNT_IN_USE"
  | "MANAGED_ELSEWHERE"
  | "ALREADY_MEMBER"
  | "LAST_ADMIN"
  | "STORAGE_OWNER"
  | "HAS_PROJECTS"
  | "NO_STORAGE"
  | "NOT_OWNER"
  | "HAS_UPLOADS"
  | "WRONG_ACCOUNT"
  | "EXPIRED"
  | "INVITE_USED"
  | "MOVED"
  | "COPIES_MISSING"
  | "NOT_CONNECTED"
  | "CONNECTION_BROKEN"
  | "PLATFORM_REFUSED";

export class ServiceError extends Error {
  code: ServiceErrorCode;
  status: 400 | 403 | 404 | 409 | 410 | 429 | 502;
  // Declared, not defined, so an absent value is not an own property set to undefined.
  declare opIndex?: number;
  declare currentVersion?: number;
  declare missing?: string[];

  constructor(
    code: ServiceErrorCode,
    status: 400 | 403 | 404 | 409 | 410 | 429 | 502,
    message: string,
    extra: { opIndex?: number; currentVersion?: number; missing?: string[] } = {},
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
    if (extra.opIndex !== undefined) this.opIndex = extra.opIndex;
    if (extra.currentVersion !== undefined) this.currentVersion = extra.currentVersion;
    if (extra.missing !== undefined) this.missing = extra.missing;
  }

  toBody(): ErrorBody {
    const body: ErrorBody = { code: this.code, message: this.message };
    if (this.opIndex !== undefined) body.opIndex = this.opIndex;
    if (this.currentVersion !== undefined) body.currentVersion = this.currentVersion;
    if (this.missing !== undefined) body.missing = this.missing;
    return body;
  }
}
