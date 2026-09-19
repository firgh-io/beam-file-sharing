# Beam — File Drop Service Design Doc

## Overview

Beam lets an anonymous user upload a file to a storage bucket, receive a shareable link, and share that link so recipients can download the file until it expires.

## Configuration Constants

These values are referenced throughout the document.

| Constant         | Value                       | Meaning                                                   |
| ---------------- | --------------------------- | --------------------------------------------------------- |
| `MAX_FILE_SIZE`  | 100 MB                      | Largest accepted file                                     |
| `QUOTA`          | 1 GB                        | Total live bytes per uploader                             |
| `MAX_EXPIRY`     | 7 days                      | Longest link lifetime an uploader may pick                |
| `DEFAULT_EXPIRY` | 24 hours                    | Applied when the uploader does not pick one               |
| `URL_TTL`        | 15 min                      | Presigned upload URL validity                             |
| `GRACE`          | 5 min                       | Slack after `URL_TTL` before quota is reclaimed           |
| `MAX_IN_FLIGHT`  | 5                           | Concurrent uploads per uploader                           |
| `QUARANTINE_TTL` | 2 days                      | Retention for malicious files before purge                |
| `LEASE_MARGIN`   | 24 hours                    | Added to a file's deadline when setting a committed lease |
| `OUTBOX_BACKOFF` | 10s, doubling, capped at 1h | Retry interval for an undelivered quota call              |

---

## Quota Accounting: Ledger, Outbox, and Lease

This section is the core of the design. Everything else follows from it.

### The problem

Quota accounting spans two Durable Objects:

- The **File DO** owns a file's state and its R2 object.
- The **User DO** owns the uploader's quota.

A Durable Object transaction covers only its own storage. There is no transaction that spans both. So `"this file is now stored"` and `"this user now uses 5 MB"` are two separate writes with a gap between them, and a crash in that gap leaves the two objects disagreeing.

Every mechanism below exists to make that gap safe.

### Why not reservations

The obvious approach is two-phase: reserve bytes at upload start, convert the reservation to usage at `/complete`, release it if anything fails.

This was the original design and it was rejected, because it mutates the quota aggregate _before_ the file exists and therefore requires an unwind on every failure path:

- Abandoned upload → must release
- Expired presigned URL → must release
- Worker eviction before `/complete` → must release
- Size mismatch → must release

Each unwind is a cross-DO call that can itself fail. When it does, the reservation is stranded and the user's quota is permanently reduced — a legitimate user locked out of a service they are not actually using. There is no self-correcting path, because the only record of the debt lives in the File DO while the bytes live in the User DO.

The replacement inverts the order: **nothing is charged until the bytes provably exist in R2.** Every failure before that point costs zero, because there is nothing to undo.

### The three mechanisms

| Mechanism  | Lives in                 | Guarantees                                                    |
| ---------- | ------------------------ | ------------------------------------------------------------- |
| **Ledger** | User DO                  | The same quota operation applied twice has the effect of once |
| **Outbox** | File DO                  | A quota operation that was decided always eventually runs     |
| **Lease**  | User DO (on ledger rows) | Quota is reclaimed even if the operation never runs at all    |

Ledger and lease provide _safety_. The outbox provides _liveness_. They are independent and all three are required.

### Ledger

The User DO holds one `quota_ledger` row per file that is either in flight or live.

```
quota_ledger
  file_id      PK
  bytes
  state        PENDING | COMMITTED
  lease_until
  updated_at
```

`used_byte` on the user row is **not** a running total. It is a cached aggregate, recomputed inside the same transaction as any mutation:

```
used_byte = SUM(bytes) WHERE state = 'COMMITTED'
```

This is what makes arithmetic drift structurally impossible. The only way to be wrong is to hold a wrong _row_, which is visible and repairable. A wrong running total is neither.

Because every operation is keyed on `file_id`, retries are free: `commit(f1)` called five times inserts one row and charges once. The idempotency comes from the key, not from careful arithmetic.

### Ledger states

- **`PENDING`** — a presigned URL has been issued for this file. The bytes are _not_ in `used_byte`, but they **are** counted in the quota check (see below). Set by `record`.
- **`COMMITTED`** — the object is confirmed present in R2 and is charged to `used_byte`. Set by `commit`.

There is no released state. A released row is deleted.

### Why `PENDING` counts against the quota

A presigned URL is a bearer capability. Once it is handed out, R2 will accept those bytes and the Worker is not in the request path to stop it. **Issuance is therefore the only correct enforcement point**, and any URL already issued must count against the cap.

The check is:

```
SUM(bytes WHERE COMMITTED) + SUM(bytes WHERE PENDING) + new_file_size > QUOTA  → reject
```

The User DO is single-threaded, so two browser tabs starting an upload at the same moment serialize: the first tab's row is durable before the second tab's check reads. There is no overshoot.

This is **not** the reservation system returning. The distinction:

|                             | Reservations (rejected) | `PENDING` ledger row   |
| --------------------------- | ----------------------- | ---------------------- |
| Aggregate mutated at init   | `reserved_byte += n`    | nothing mutated        |
| Release required on abandon | yes, cross-DO call      | no — the lease expires |
| Leak if that call fails     | permanent               | impossible             |
| Unwind paths that can fail  | 2                       | 0                      |

A `PENDING` row participates in a _read_ at check time and deletes itself at `lease_until`. Nothing has to succeed for the quota to come back.

**Accepted trade-off:** a user who abandons a large upload cannot start another until the lease expires — at most `URL_TTL + GRACE` (20 minutes). This is preferred over the alternative, which permits `MAX_IN_FLIGHT × MAX_FILE_SIZE` of overshoot. Known failure paths (size mismatch, File DO creation failure) release the row immediately rather than waiting out the lease.

### Lease

Every ledger row carries `lease_until` — a self-expiring claim on quota.

| State       | `lease_until`                                   |
| ----------- | ----------------------------------------------- |
| `PENDING`   | `now + URL_TTL + GRACE`                         |
| `COMMITTED` | `<the file's own next deadline> + LEASE_MARGIN` |

For a `COMMITTED` row the deadline is normally `expires_at`. For a quarantined file it is `status_updated_at + QUARANTINE_TTL`, which can fall _after_ `expires_at` — so quarantining must extend the lease (see [Process File](#4-process-file)).

**Rule: whenever the lifecycle alarm is re-armed, the lease is re-armed to the same deadline.**

Pruning is lazy. Every public User DO method begins with:

```
prune():
  DELETE FROM quota_ledger WHERE lease_until < now
  if any rows were deleted: recompute used_byte
```

No cron, no sweeper, no callback. This is safe because nothing in the system lives beyond `MAX_EXPIRY`, so "past its deadline plus margin" is always sufficient reason to drop a row:

- An expired `PENDING` row means the presigned URL is dead and the upload can never complete.
- An expired `COMMITTED` row means the file's own deadline passed a day ago and its `release` never landed.

The lease is the backstop, not the primary path. Normally `release` deletes the row at the right moment; the lease only catches rows where that call never happened.

### Outbox

The ledger makes a repeated call harmless. It does not make the call _happen_. If the Worker dies between changing file status and calling the User DO, nothing retries.

The File DO therefore records the intent durably, in the same transaction as the state change:

```
outbox
  id           PK
  op           commit | release
  file_id
  bytes        (commit only)
  lease_until  (commit only)
  attempts
  created_at
```

The invariant:

> **The File DO never changes state without writing, in the same transaction, whatever it now owes the User DO.**

`drainOutbox()` is the only place the File DO calls the User DO:

```
drainOutbox():
  for each row in outbox, oldest first:
    try:
      op == 'commit'  → USER_DO.commit(file_id, bytes, lease_until)
      op == 'release' → USER_DO.release(file_id)
      DELETE the row          ← only after the call returned ok
    catch:
      attempts += 1
      re-arm alarm for retry
      stop
```

The row is deleted only on success. At-least-once delivery into an idempotent receiver gives effectively-once. If the call succeeded but the delete did not, the retry calls again — harmless.

An empty outbox means the File DO owes nothing. A non-empty outbox on a healthy file means a hand-off is in progress or stalled, and is a useful thing to alert on.

### Why the resume check reads the outbox, not the status

A retried `/complete` must distinguish three situations. Only the outbox distinguishes them correctly:

| Observed                               | Meaning                           | Action            |
| -------------------------------------- | --------------------------------- | ----------------- |
| Outbox has a row                       | Crashed mid-hand-off; debt unpaid | Drain, return 200 |
| Outbox empty, ledger `COMMITTED`       | True replay; already charged      | Return 200        |
| Outbox empty, status `AWAITING_UPLOAD` | First call                        | Proceed           |

Branching on `status == 'STORED'` alone would return success for a file whose bytes were never charged, permanently and silently.

### The single alarm

A Durable Object has exactly one alarm, and `setAlarm` overwrites it. Three things want to schedule work on the File DO:

1. The lifecycle deadline for the current status
2. An outbox retry, when a row is open
3. The `STORED` watchdog (see [Open Items](#open-items))

They cannot each call `setAlarm` directly. All scheduling goes through one function:

```
rearmAlarm():
  candidates = [ earliest outbox retry time (if any open row),
                 lifecycle deadline for current status (if any) ]
  if candidates: setAlarm(min(candidates))
```

And the handler serves all of them:

```
alarm():
  drainOutbox()        ← always first; may be an unpaid debt
  runLifecycle()       ← expiry / quarantine purge / abandoned upload
  rearmAlarm()
```

Every transition that changes a deadline calls `rearmAlarm()`, never `setAlarm` directly.

### What each mechanism catches

| Failure                                                        | Caught by                           |
| -------------------------------------------------------------- | ----------------------------------- |
| Anything before `/complete` (abandon, expired URL, closed tab) | Charging late — nothing was written |
| The same quota call arriving twice                             | Ledger                              |
| The call never being made (worker eviction)                    | Outbox                              |
| The File DO never recovering                                   | Lease                               |
| The R2 object outliving everything                             | R2 bucket lifecycle rule            |

---

## High Level Design

### End-to-End Flow

```text
 ┌────────┐        ┌────────┐        ┌─────────┐        ┌─────────┐      ┌────┐
 │ Client │        │ Worker │        │ User DO │        │ File DO │      │ R2 │
 └───┬────┘        └───┬────┘        └────┬────┘        └────┬────┘      └─┬──┘
     │                 │                  │                  │             │
  1  │ POST /v1/uploads│                  │                  │             │
     ├────────────────>│                  │                  │             │
     │                 │ record()         │                  │             │
     │                 ├─────────────────>│ prune            │             │
     │                 │                  │ replay? quota?   │             │
     │                 │                  │ INSERT PENDING   │             │
     │                 │<─────────────────┤ (used_byte       │             │
     │                 │                  │  unchanged)      │             │
     │                 │ initialize()     │                  │             │
     │                 ├─────────────────────────────────────>│            │
     │                 │                  │      AWAITING_UPLOAD + alarm   │
     │ 202 + url+id    │<─────────────────────────────────────┤            │
     │<────────────────┤                  │                  │             │
     │                 │                  │                  │             │
  2  │ PUT file (presigned, streamed)     │                  │             │
     ├──────────────────────────────────────────────────────────────────-─>│
     │                 │                  │                  │             │
  3  │ POST /complete  │                  │                  │             │
     ├─────────────────────────────────────────────────────-─>│            │
     │                 │                  │      auth + resume check       │
     │                 │                  │                  │ HEAD        │
     │                 │                  │                  ├────────────>│
     │                 │                  │                  │<────────────┤
     │                 │                  │        ┌─────────┴─────────┐   │
     │                 │                  │        │  ONE TRANSACTION  │   │
     │                 │                  │        │  status = STORED  │   │
     │                 │                  │        │  outbox += commit │   │
     │                 │                  │        └─────────┬─────────┘   │
     │                 │                  │ commit()         │             │
     │                 │                  │<─────────────────┤ drainOutbox │
     │                 │                  │ PENDING→COMMITTED│             │
     │                 │                  │ used_byte += n   │             │
     │                 │                  ├─────────────────>│ DELETE row  │
     │ 201 + share url │                  │                  │             │
     │<─────────────────────────────────────────────────────-┤ queue scan  │
     │                 │                  │                  │             │

                       ── asynchronous from here ──

     Scan queue ──> clean     → AVAILABLE                (alarm: expires_at)
                └─> malware   → QUARANTINED + move to quarantine/
                                 + extend lease          (alarm: +QUARANTINE_TTL)
                └─> checksum  → txn{ DELETED, outbox += release } → drain
                    mismatch

     Alarm fires ──> drainOutbox()   (pay any unpaid debt first)
                 └─> runLifecycle()  txn{ EXPIRED|DELETED, outbox += release }
                                     delete R2 object
                                     drainOutbox()
                 └─> rearmAlarm()

     Lease expiry ─> User DO prunes the row on its next operation.
                     No call from anywhere is required.

  4  GET /files/:file_id
     ├── File DO: one transaction — status, expiry, download limit, count += 1
     └── Worker: stream object from R2
```

### File Status Lifecycle

```text
                    AWAITING_UPLOAD
                     │           │
        /complete ok │           │ abandoned (alarm)
                     ▼           │
                  STORED         │
                  │     │        │
            clean │     │ malware│
                  ▼     ▼        │
          AVAILABLE   QUARANTINED│
                  │     │        │
          expires │     │ purge  │
                  ▼     ▼        ▼
              EXPIRED / DELETED
                (R2 object gone,
                 quota released)
```

`AWAITING_UPLOAD → DELETED` is the cheapest path in the system: no bytes in R2, and the ledger row was never charged.

---

## Upload Flow

### 1. Initialize Upload

`POST /v1/uploads`

The client performs basic validation before sending metadata to the Worker:

1. `file_size <= MAX_FILE_SIZE`
2. `expires_at` is in the future and at most `MAX_EXPIRY`
3. Webhook URL is a valid URL not pointing to internal networks
4. `max_download_count >= 1`

The client also computes the file size and SHA-256 hash and sends them as part of the request.

The Worker then:

1. **Rate limit** on the request's IP.
   - _Note:_ because uploads are anonymous, IP is used as the rate-limit key. This may group multiple legitimate users behind one NAT/proxy, an acceptable trade-off for anonymous abuse prevention.
2. **Identify the user** from the HTTP-only cookie; mint one if absent.
3. **Server-validate** the input: `file_size <= MAX_FILE_SIZE`, `expires_at` in future and `<= MAX_EXPIRY` (defaulting to `DEFAULT_EXPIRY` if absent), `max_download_count >= 1`, webhook URL, content type, hash format.
4. **Generate `file_id`.** Generated once, _outside_ any retry loop — the ledger's replay guard is keyed on it, so a regenerated id on retry would double-count.
5. **`USER_DO.record(file_id, file_size, now + URL_TTL + GRACE)`.** In one transaction:
   1. `prune()` — drop rows whose `lease_until` has passed.
   2. If a row for `file_id` already exists, this is a retry of this same call → return `{ ok: true }`.
   3. If `COUNT(*) WHERE state = 'PENDING' >= MAX_IN_FLIGHT` → return `{ ok: false, code: 'IN_FLIGHT_LIMIT' }`.
   4. If `SUM(COMMITTED) + SUM(PENDING) + file_size > QUOTA` → return `{ ok: false, code: 'QUOTA_EXCEEDED' }`.
   5. `INSERT (file_id, file_size, 'PENDING', lease_until)`.
   6. Return `{ ok: true }`. **`used_byte` is deliberately not modified** — `PENDING` is recorded, not charged.
6. If `record` returned `{ ok: false }`, return the corresponding error. **No File DO is created.**
7. **`FILE_DO.initialize(file_id, …)`.** In one transaction:
   1. If a file row already exists, this is a retry → return `{ ok: true }`.
   2. Insert the file row with `status = AWAITING_UPLOAD`, `scan_status = NOT_SCANNED`.
   3. `rearmAlarm()` → `created_at + URL_TTL + GRACE`.
   4. Return `{ ok: true }`.

   If this call fails after `record` succeeded, the Worker issues a best-effort `USER_DO.release(file_id)` to reclaim the row immediately. This is an optimization only — if it also fails, the lease reclaims the row within `URL_TTL + GRACE`.

8. **Return the presigned URL + `file_id`.** Content-length, content-type, and expiry are baked into the cryptographic signature, so the client cannot alter the permitted size or type without invalidating the URL.

**Ordering note:** the quota check runs _before_ the File DO exists. A rejected upload therefore leaves nothing behind. The only possible orphan is a `PENDING` ledger row, which is uncounted in `used_byte` and self-expiring.

### 2. Upload File

The client PUTs the file directly to R2 using the presigned URL. No Worker is in the byte path. R2 rejects any body whose length does not match the signature, which is how the size cap is enforced before storage. The browser can display progress from bytes-uploaded against total size.

**Note on the URL expiry:** `URL_TTL` governs how long the URL may be _used to start_ an upload. R2 validates the signature at request start, so a PUT beginning just before expiry completes normally. It has no relationship to `expires_at`, which is Beam's own link-validity field and is unknown to R2.

### 3. Complete Upload

`POST /v1/uploads/:file_id/complete`

1. **Authenticate.** Compare the File DO's `owner_id` against the `anon_id` cookie. On mismatch, return 401.
2. **Resume check** (in this order):
   1. Outbox is non-empty → `drainOutbox()`, return 200. A previous attempt crashed mid-hand-off.
   2. Ledger row for this file is `COMMITTED` → return 200. True replay.
   3. Status is `AWAITING_UPLOAD` → proceed.
   4. Any other status → return the corresponding error.
3. **HEAD R2.**
   - **Object present and `head.size == file_size`** → proceed to step 4.
   - **Object missing, still within `created_at + URL_TTL + GRACE`** → return a retryable error. The upload may still be in flight; do not mark the file dead. The lifecycle alarm handles it if it never arrives.
   - **Object missing past that window, or size mismatch** →
     1. One transaction: `status = DELETED`, `outbox += ('release', file_id)`.
     2. Delete the R2 object if one exists.
     3. `drainOutbox()`.
     4. `rearmAlarm()`, return the error.
4. **One transaction:** `status = STORED`, `scan_status = PENDING`, `outbox += ('commit', file_id, head.size, expires_at + LEASE_MARGIN)`.

   This is the crash-safe point. Status and debt land together or not at all.

5. **`rearmAlarm()`**, then **`drainOutbox()`** → `USER_DO.commit(...)`.

   The alarm is armed _before_ the call so that a crash during the call still leaves a retry scheduled. On the happy path the inline drain wins, the row is deleted, and the alarm later fires into an empty outbox and no-ops.

6. **Queue the file for scanning** (`file_id` onto the scan queue).
7. **Return the shareable file URL.**

**On `commit` charging `head.size`:** the amount charged comes from R2's HEAD response, never the client's declared `file_size`. A client that lies about or retries with different metadata cannot skew the accounting.

### 4. Process File

A queue consumer picks up the `file_id`:

1. Skip unless `scan_status ∈ {PENDING, ERROR}` and `status == STORED`.
2. Scan for malware. If positive:
   - `scan_status = MALICIOUS`, `status = QUARANTINED`.
   - Move the R2 object from `active/` to `quarantine/`.
   - `USER_DO.extend(file_id, status_updated_at + QUARANTINE_TTL + LEASE_MARGIN)` — **required**, because the quarantine deadline can fall after `expires_at`, and without extending, `prune` would drop the ledger row while the object still exists in R2.
   - `rearmAlarm()` → `status_updated_at + QUARANTINE_TTL`.
3. Compare the checksum of the authoritative R2 object against the stored metadata. On mismatch:
   - One transaction: `status = DELETED`, `outbox += ('release', file_id)`.
   - Delete the R2 object, `drainOutbox()`, `rearmAlarm()`.
4. If clean and checksum + size validate: `scan_status = CLEAN`, `status = AVAILABLE`, `rearmAlarm()` → `expires_at`.
5. On any scan error: `scan_status = ERROR`, then throw so the queue retries. After repeated failures the message goes to a DLQ.
6. Queue webhook delivery with the scan status.

_Note:_ step 6 is queued rather than run inline so that a webhook delivery failure does not force a re-run of the whole pipeline. Each step retries independently.

### Download Flow

1. User requests `https://{url}/files/:file_id`.
2. Load the File DO.
3. **In a single File DO transaction**, check and increment together:
   - `status == AVAILABLE`, else return the error for the current status.
   - `now < expires_at`, else return expired.
   - `max_download_count IS NULL OR download_count < max_download_count`, else return limit exceeded.
   - `download_count += 1`.
4. Stream the object from R2 back to the user.

The check and the increment must be one operation. Split across two, two clients racing for the last download would both pass. The Durable Object's single-threaded execution is what serializes them.

**Note:** `download_count` counts streams _authorized_ by the server. It is incremented before the stream starts, and a download is counted regardless of whether the subsequent R2 stream succeeds.

The download path never touches the User DO. Downloads are the highest-frequency operation in the system and cost zero quota work.

### Cleanup Process

Each File DO uses its single alarm for all deadline-driven work. The alarm is **deadline-based**, not periodic: it is always scheduled for the nearest point where action may be required, via `rearmAlarm()`.

There is no periodic alarm and no cron sweep over files. This avoids wakeups for files with nothing to do.

#### Lifecycle deadlines

| File status           | Deadline                             | Action                                                       |
| --------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `AWAITING_UPLOAD`     | `created_at + URL_TTL + GRACE`       | Clean up the incomplete upload                               |
| `STORED`              | _(see Open Items — watchdog needed)_ | —                                                            |
| `AVAILABLE`           | `expires_at`                         | Mark `EXPIRED`, delete the R2 object, release quota          |
| `QUARANTINED`         | `status_updated_at + QUARANTINE_TTL` | Delete the quarantined object, mark `DELETED`, release quota |
| `EXPIRED` / `DELETED` | none                                 | Terminal                                                     |

An open outbox row is an independent alarm claimant at `OUTBOX_BACKOFF`; `rearmAlarm()` picks whichever deadline is nearer.

#### Alarm handling

```
alarm():
  drainOutbox()      ← always first
  runLifecycle()
  rearmAlarm()
```

`runLifecycle()` re-reads current state before acting, so a stale alarm cannot perform cleanup for a state that has already changed. Every branch has the same three-step shape:

```
verify the status and deadline still hold
one transaction: status = <terminal>, outbox += ('release', file_id)
delete the R2 object
drainOutbox()
```

- **`AWAITING_UPLOAD`** → `DELETED`. Deletes any partial R2 object.
- **`AVAILABLE`** past `expires_at` → `EXPIRED`.
- **`QUARANTINED`** past retention → `DELETED`. Deletes from `quarantine/`.

All cleanup operations are idempotent. An R2 delete on a missing key is a no-op; `release` on an absent ledger row is a no-op. Repeating any of them cannot release quota twice or corrupt state.

#### R2 bucket lifecycle backstop

R2 supports lifecycle rules at the **bucket** level (by prefix), not a per-object TTL. Per-file expiry is therefore the File DO alarm's job — it is the only mechanism that can honour a user-chosen deadline.

As a final backstop, independent of any Beam code:

```
active/      → delete 8 days after creation   (MAX_EXPIRY + margin)
quarantine/  → delete 3 days after creation   (QUARANTINE_TTL + margin)
```

This catches the one gap the lease leaves open: if a File DO is wedged and never runs cleanup, `prune` reclaims the quota at the lease deadline but nothing deletes the object. Lifecycle deletion does not notify Beam, so the two cleanup mechanisms are genuinely independent — neither informs the other.

---

## Key Components

- Workers
- Durable Objects
- Queue
- Cloudflare R2

## Durable Objects Design

### Justification

- DOs give single-threaded, strongly consistent coordination around a single entity. Most operations here are naturally serialized per file or per user.
- The volume of data does not justify a database.
- Several checks must guard against simultaneous requests — the last-download race, the quota check under concurrent tabs. This would normally need a distributed lock (Redis or similar); with a DO it is inherent.

### Data Models

The uploader is identified by a generated id stored in an HTTP-only cookie.

- Best-effort tracking of users and their uploads.
- Fast lookup of a user's quota state.
- **Caveat:** a user can clear the cookie to reset their quota. This is accepted — the quota is best-effort. Velocity abuse is bounded by the IP rate limiter and by `MAX_IN_FLIGHT`, and files are short-lived.

### Partitioning

Two Durable Object classes: **File DO** (one per file) and **User DO** (one per uploader). Both store data as SQLite tables rather than KV, for structured records and transactional updates.

Calls only ever go **File DO → User DO**. The User DO never calls back, holds no reference to any File DO, and has no alarm. That one-directional dependency is what keeps the coordination tractable.

#### User DO

**`user` table** (exactly one row)

| Column       | Type   | Notes                                                                                           |
| ------------ | ------ | ----------------------------------------------------------------------------------------------- |
| `id`         | pk     |                                                                                                 |
| `created_at` | string |                                                                                                 |
| `used_byte`  | int    | Cached aggregate of `SUM(bytes) WHERE state='COMMITTED'`. Never incremented; always recomputed. |

**`quota_ledger` table** (one row per in-flight or live file)

| Column        | Type   | Notes                                                 |
| ------------- | ------ | ----------------------------------------------------- |
| `file_id`     | pk     | Idempotency key for every quota operation             |
| `bytes`       | int    | From R2's HEAD once committed, not the client's claim |
| `state`       | string | `PENDING` \| `COMMITTED`                              |
| `lease_until` | string | Self-expiring claim; pruned when passed               |
| `updated_at`  | string |                                                       |

Indexes: `lease_until` (prune), `state` (aggregates).

**RPC methods** — all wrapped in a single storage transaction, all beginning with `prune()`:

| Method                                       | Behaviour                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record(file_id, bytes, lease_until)`        | Replay → ok. In-flight cap → reject. `SUM(COMMITTED) + SUM(PENDING) + bytes > QUOTA` → reject. Else insert `PENDING`. Does not touch `used_byte`.                                                                                                                                                                         |
| `commit(file_id, actual_bytes, lease_until)` | No row → insert as `COMMITTED` (lease expired mid-flight but the object is real, so it must be charged; erroring here would let a slow upload dodge quota). Row already `COMMITTED` → return ok, no mutation. Row `PENDING` → set `COMMITTED`, `bytes = actual_bytes`, rewrite `lease_until`. Then recompute `used_byte`. |
| `release(file_id)`                           | Delete the row if present (no-op if absent). Recompute `used_byte`.                                                                                                                                                                                                                                                       |
| `extend(file_id, lease_until)`               | Push the lease out. Used when quarantine extends a file's life beyond `expires_at`.                                                                                                                                                                                                                                       |

`commit` rewriting `lease_until` is what moves a row off the short upload clock onto the file's own deadline.

#### File DO

**`file` table** (exactly one row)

| Column                   | Type                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `file_id`                | pk                                                               |
| `owner_id`               | string — the uploader's id                                       |
| `file_blob_id`           | string — R2 key, including the `active/` or `quarantine/` prefix |
| `file_name`              | string                                                           |
| `file_type`              | string                                                           |
| `file_size`              | int — as declared at init                                        |
| `file_sha256`            | string                                                           |
| `status`                 | string                                                           |
| `status_updated_at`      | string                                                           |
| `scan_status`            | string                                                           |
| `scan_status_updated_at` | string                                                           |
| `expires_at`             | string                                                           |
| `download_count`         | int                                                              |
| `max_download_count`     | int, nullable                                                    |
| `webhook_url`            | string, nullable                                                 |
| `created_at`             | string                                                           |

There is no `quota_state` column. Quota state lives solely in the User DO's ledger, keyed by `file_id`. Mirroring it here is what made the previous design's guard and mutation live in different objects, which is the failure the ledger removes.

`file_blob_id` includes the R2 prefix so cleanup never has to infer the object's location from status.

**`outbox` table** (empty except during a hand-off)

| Column        | Type             | Notes                                       |
| ------------- | ---------------- | ------------------------------------------- |
| `id`          | pk               |                                             |
| `op`          | string           | `commit` \| `release`                       |
| `file_id`     | string           |                                             |
| `bytes`       | int, nullable    | `commit` only                               |
| `lease_until` | string, nullable | `commit` only                               |
| `attempts`    | int              | Drives backoff; worth exporting as a metric |
| `created_at`  | string           |                                             |

In a healthy system essentially every outbox is empty. A row means the File DO owes the User DO a call that has not yet been confirmed.

### Status Lifecycle

**File status** — `AWAITING_UPLOAD`, `STORED`, `AVAILABLE`, `EXPIRED`, `QUARANTINED`, `DELETED`.

- `AWAITING_UPLOAD` — set at init, before the client uploads.
- `STORED` — set at `/complete` once R2 confirms the object; queued for scanning.
- `AVAILABLE` — scan clean. The only downloadable status.
- `EXPIRED` — passed `expires_at`; R2 object deleted, quota released.
- `QUARANTINED` — malware detected; object moved to `quarantine/`.
- `DELETED` — abandoned upload, failed verification, checksum mismatch, or purged quarantine. R2 object deleted, quota released.

**Scan status** — `NOT_SCANNED`, `PENDING`, `CLEAN`, `MALICIOUS`, `ERROR`.

- `NOT_SCANNED` at creation → `PENDING` when queued → `CLEAN` / `MALICIOUS` on verdict, or `ERROR` on failure (retryable).

**Ledger state** — `PENDING`, `COMMITTED`. See [Ledger states](#ledger-states). Released rows are deleted, not marked.

Both `status` and `scan_status` update their `*_updated_at` field on every change.

## R2 Directory Design

```text
R2
├── active/
│   └── <blob>
└── quarantine/
    └── <blob>
```

---

## Decisions

### Presigned URL for uploads, streaming for downloads

1. Cloudflare enforces a strict incoming request body limit on Workers (100 MB–500 MB depending on plan). We currently cap files at 100 MB, but a future increase would hit that ceiling, and streaming an upload _to_ a Worker does not bypass it — Cloudflare rejects oversized bodies at the edge before our code runs.
2. Cloudflare does not enforce response body size limits. A Worker can stream an arbitrarily large object down to a client without buffering.

A presigned URL therefore keeps uploads out of the Worker entirely, while downloads stream through it — and this asymmetry is also what makes issuance the quota enforcement point (see [Why `PENDING` counts against the quota](#why-pending-counts-against-the-quota)).

### No downloads before the scan completes

Serving unscanned files would let an attacker distribute malware from our domain. Files are downloadable only in `AVAILABLE`. Before that, the link returns a "come back later" response.

### Rate limiting

- Cloudflare's built-in Rate Limiting binding, configured as a fixed window keyed on client IP.
- The API is approximate and eventually consistent: counters are local to each location and propagate asynchronously, so concurrent requests arriving at different isolates can both be accepted.
- Acceptable, because the limiter is a velocity control, not an authoritative quota. Authoritative limits — the 1 GB storage cap and the download count — are enforced transactionally inside the relevant Durable Object.

---

## API Design

### `POST /v1/uploads`

Initialize an upload.

**Request body**

- `file_name`: string
- `file_size`: integer
- `file_sha256`: string
- `file_type`: string
- `expires_at`: string (optional; defaults to `DEFAULT_EXPIRY`, max `MAX_EXPIRY`)
- `webhook_url`: string (optional)
- `max_download_count`: integer (optional)

**Cookie:** `anon_id`

**Success — 202**

- Body: `presigned_url`, `file_id`
- Header: `Set-Cookie: anon_id=…; HttpOnly`

**Errors**

| Status | Code                      | Meaning                                                 |
| ------ | ------------------------- | ------------------------------------------------------- |
| 429    | `TOO_MANY_REQUESTS`       | Rate limit exceeded                                     |
| 403    | `FILE_SIZE_LIMIT_REACHED` | Would exceed the 1 GB cap (committed + in-flight + new) |
| 403    | `IN_FLIGHT_LIMIT`         | More than `MAX_IN_FLIGHT` uploads already pending       |
| 400    | `BAD_REQUEST`             | Input validation failed                                 |
| 500    | `INTERNAL_SERVER_ERROR`   |                                                         |

### `POST /v1/uploads/:file_id/complete`

Complete an upload and queue it for scanning.

**Cookie:** `anon_id`

**Success — 200**, body: `share_url`

**Errors**

| Status | Code                       | Meaning                                                          |
| ------ | -------------------------- | ---------------------------------------------------------------- |
| 401    | `UNAUTHORIZED_FILE_ACCESS` | `anon_id` does not match `owner_id`                              |
| 409    | `UPLOAD_NOT_VISIBLE_YET`   | Object not in R2 yet, still within the upload window — retryable |
| 400    | `FILE_NOT_FOUND`           | Object absent past the upload window                             |
| 400    | `FILE_SIZE_MISMATCH`       | R2 object size differs from the declared size                    |

### `GET /files/:file_id`

Download a file.

**Success — 200**

- `Content-Type`: stored content type
- `Content-Length`: stored size
- `Content-Disposition`: `attachment; filename="<file_name>"`
- Body: streamed R2 object

**Errors**

| Status | Code                           | Meaning                |
| ------ | ------------------------------ | ---------------------- |
| 403    | `FILE_NOT_READY`               | Scan not finished      |
| 403    | `FILE_EXPIRED`                 | Past `expires_at`      |
| 403    | `FILE_DOWNLOAD_LIMIT_EXCEEDED` | Download cap reached   |
| 404    | `FILE_UNAVAILABLE`             | Deleted or quarantined |

---

## Security

### Webhook validation

- Parse with a strict URL library.
- Allow HTTPS only.
- Reject URLs containing userinfo or fragments, and any port other than 443.

---

## Error Handling

### Cross-DO quota operations

Handled entirely by the ledger/outbox/lease mechanism described above. In summary:

- **Retry safety** comes from the ledger's `file_id` key and from recomputing `used_byte` rather than incrementing it. `commit` and `release` may be called any number of times with the effect of one.
- **Delivery** comes from the outbox: the intent is durable before the call is attempted, and the row is deleted only after the call returns.
- **Retry policy** is alarm-driven with exponential backoff from `OUTBOX_BACKOFF`, capped at one hour. Retries are not bounded by a fixed count — the operation is cheap and idempotent, and the file's own lifetime bounds the loop. `attempts` is exported as a metric; a File DO exceeding a few attempts indicates an unhealthy User DO.
- **Last resort** is the lease. If the call never lands, `prune` reclaims the quota at the row's deadline.

_Note:_ the download counter and the `used_byte` aggregate are the only mutable numeric state. The counter is incremented inside a single-DO transaction and needs no cross-object coordination; `used_byte` is derived, never incremented.

### Upload init: `record` succeeded, `initialize` failed

The Worker returns 500. A `PENDING` ledger row is left behind. It is **not** counted in `used_byte`, and it self-expires within `URL_TTL + GRACE`. The Worker additionally issues a best-effort `release` to reclaim it immediately; if that call also fails, the lease is sufficient.

The reverse case cannot occur: the quota check runs before the File DO is created, so there is no path that creates an uploadable file which was never counted.

### Upload PUT failure

The client retries the whole flow, which generates a new `file_id`. The abandoned `PENDING` row expires; the abandoned File DO is cleaned up by its `AWAITING_UPLOAD` alarm. Neither charges the user.

### Cleanup ran but the User DO was not updated

The `release` sits in the outbox and is retried by the alarm. If the File DO never recovers at all, the ledger row's lease expires and `prune` reclaims the quota on the User DO's next operation. The R2 object in that scenario is orphaned; the bucket lifecycle rule deletes it.

### Scanning error

`scan_status = ERROR`, then throw to trigger the queue's retry. After repeated failures the message goes to a DLQ.

### Quarantine lifecycle

Malicious files are marked `QUARANTINED`, moved to `quarantine/`, and purged after `QUARANTINE_TTL`. A production system would also record the file hash, upload timestamp, user id, and threat name in a security audit log for tracking repeat offenders; that is out of scope here.

---

## Open Items

Known gaps, not yet addressed in this revision.

- **`STORED` has no watchdog alarm.** If the scan message is lost or lands in the DLQ, the file stays `STORED` — committed against quota, undownloadable, with no deadline. It needs a lifecycle deadline even though the queue drives the normal path. `scan_status = ERROR` after retry exhaustion likewise has no terminal state.
- **ID scheme is unspecified.** The share link is a bearer token, so the public identifier must be unguessable and non-enumerable, and should be separate from the internal DO key. The same applies to `anon_id`, which currently authorizes `/complete`.
- **Expired and unknown links return 403.** These should be 410 and 404 respectively.
- **`GET /files/:file_id` serves both a landing page and raw bytes.** As one route, link unfurlers and browser prefetchers will consume `max_download_count` when the link is pasted into a chat client. Needs splitting into a landing route and a download route.
- **Webhook delivery is underspecified** — payload schema, signing, retry policy, timeout, dedupe key, and terminal-failure behaviour.
- **Rate limiting covers only `POST /v1/uploads`.** `/complete` and downloads are unlimited. No `Retry-After` header is returned on 429. The choice of fixed-window over sliding-window or token-bucket is not justified.
- **No file-count cap.** 1 GB of 1 KB files is one million Durable Objects.
- **Content-type is echoed from client input** on download — a stored `text/html` file served from our origin is a phishing vector. Needs `X-Content-Type-Options: nosniff`, a separate download domain, and magic-byte verification during the scan.
- **`file_name` is not sanitized** before entering `Content-Disposition` (CRLF injection, quote breaking, RFC 5987 encoding for non-ASCII).
- **Cookie attributes** beyond `HttpOnly` are unspecified: `Secure`, `SameSite`, `Path`, `Max-Age`.
- **Not yet covered:** R2 bucket CORS configuration (required for the browser PUT), Range request handling on downloads, a user-initiated delete/revoke endpoint, a zero-byte check, and observability (DLQ depth, outbox `attempts`, quota drift, scan latency).
