import { Duration } from "effect";
import { MAX_FILE_SIZE, MAX_EXPIRY_IN_DAYS } from "../../shared/limits";

export { MAX_FILE_SIZE, MAX_EXPIRY_IN_DAYS };

export const USER_COOKIE_IDENTIFIER = "anon_id";

export const USER_QUOTA_BYTES = 1024 * 1024 * 1024;

export const LEASE_MARGIN = Duration.hours(24);

export const DEFAULT_EXPIRY = Duration.hours(24);

export const FILE_DO_ALARM_ID = "file-do-alarm-trigger";

export const QUARANTINE_TTL = Duration.days(2);

export const SCAN_TIMEOUT = Duration.hours(1);

export const MAX_OUTBOX_DRAIN_ATTEMPT = 10;

export const errorCode = {
  tooManyRequests: "TOO_MANY_REQUESTS",
  payloadInvalid: "BAD_REQUEST",
  quotaExceeded: "QUOTA_EXCEEDED",
  unauthorizedFileAccess: "UNAUTHORIZED_FILE_ACCESS",
  fileNotFound: "FILE_NOT_FOUND",
  fileNotAccessible: "FILE_NOT_ACCESSIBLE",
  fileSizeMismatch: "FILE_SIZE_MISMATCH",
  fileExpired: "FILE_EXPIRED",
  downloadLimitExceeded: "DOWNLOAD_LIMIT_EXCEEDED",
  fileNotAvailable: "FILE_NOT_AVAILABLE",
};

export const URL_TTL = Duration.minutes(15);
export const LEASE_GRACE = Duration.minutes(5);

export const MALWARE_FLAG_RATE = 0.02;

export const SCAN_DURATION_MIN = Duration.seconds(2);

export const SCAN_DURATION_MAX = Duration.seconds(10);

export const SCAN_FAILURE_RATE = 0.1;
