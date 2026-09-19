# Challenge: Beam — a file-drop service

A WeTransfer-style service: someone uploads a file, gets a short link, shares it; recipients download it until the link expires. Realistic product, and it exercises everything you've learned plus the next tier: R2, Durable Objects, queues, rate limiting, caching, scheduled jobs, streaming.

**Process (in this order):**

1. Write a short design doc first: components, data flow per operation, and _why_ each Cloudflare primitive was chosen over alternatives. Get it reviewed before coding.
2. Implement in milestones. Each milestone should deploy and have at least one integration test.
3. Code review after each milestone.

Design decisions are yours — including the API shape, ID scheme, and data model. The requirements below say _what_, never _how_ — and no requirement mandates a specific primitive: if you can justify meeting a requirement with fewer moving parts, that's a _better_ design, not a shortcut.

Milestones are independent stopping points. M1–M2 alone is a complete, shippable product; stop wherever the learning stops.

---

## Milestone 1 — Core sharing

- Upload a file (up to 100 MB) and receive a short shareable ID.
- Download via that ID, with the original filename and content type preserved.
- Every link has an expiry: a time limit (uploader picks, max 7 days, default 24h) AND an optional max-download count (e.g. "burns after 5 downloads"). Whichever hits first kills the link.
- Expired or unknown IDs return a proper 404/410 — including the case where the file bytes still exist but the link has expired.
- Memory discipline: no route may buffer a whole file. Uploads and downloads stream.

Questions your design doc must answer:

- Where does per-file metadata (filename, expiry, download count) live, and why there?
- How is "max downloads" enforced correctly under concurrent downloads? (Two clients grabbing the last download simultaneously — who wins?)
- What is your ID scheme, and can IDs collide?

## Milestone 2 — Limits & abuse control

- Rate limiting: an uploader (keyed however you justify — IP, API key) may perform at most N uploads per minute with burst tolerance; downloads rate-limited more generously. 429 with a `Retry-After` header when exceeded.
- Per-uploader storage quota: total live bytes per uploader capped (e.g. 1 GB); uploads that would exceed it are rejected with a useful error.
- Size cap enforced before the file is fully stored, not after.

Questions to answer:

- Which rate-limiting algorithm (fixed window / sliding window / token bucket) and why?
- Where does the rate limiter's state live so that two simultaneous requests can't both pass the same last token?
- How does quota accounting stay correct when uploads fail halfway?

## Milestone 3 — Async processing pipeline

On every successful upload, _after_ responding to the uploader (they must not wait):

- Compute and store the file's SHA-256 checksum.
- Run a (simulated) malware scan: a step that takes 2–10 s and flags ~1 in 50 files. Flagged files become undownloadable with a distinct status code.
- If the uploader registered a webhook URL, notify it when processing completes. Webhook delivery must retry with backoff on failure and give up after a bounded number of attempts without poisoning other work.

Questions to answer:

- Queue vs. direct RPC vs. Workflow for this pipeline — which and why?
- What happens if the scan step crashes mid-file? How many times can a file be scanned, and is that safe?
- Can a recipient download a file in the window between upload and scan verdict? Defend whichever answer you choose.

## Milestone 4 — Housekeeping & observability

- Expired files' bytes must actually be deleted from storage on a schedule (not just made inaccessible), and quota accounting updated.
- A stats endpoint per uploader: live files, total bytes, total downloads, files pending scan. Must be cheap to serve (not a scan over all objects per request).
- A global admin stats endpoint that would stay cheap at 10M files.

Questions to answer:

- Cron sweep vs. per-file alarms for expiry deletion — trade-offs, and which did you pick?
- Where do the counters live and what's the write amplification per download?

## Milestone 5 (stretch) — Performance & polish

- Hot-file caching: a file downloaded 100×/min should mostly not hit R2. Prove it (log cache hit/miss).
- Download progress: an endpoint streaming live download-count updates for a file (you have the pieces from `tick`).
- Split the system into ≥2 workers along a justified service boundary (public API vs. background processing), communicating properly.

---

## Non-functional bar (applies to every milestone)

- **Least privilege:** every binding uses the narrowest capability that works (a route that only reads the bucket must not hold write access).
- **Typed errors:** domain failures (expired, quota exceeded, scan-flagged, rate-limited) are tagged errors handled with `catchTag` → correct status codes; only genuine bugs reach `orDie`.
- **Two-halves discipline:** nothing request-scoped in outer generators; nothing binding-scoped in handlers.
- **Deploy hygiene:** stable logical IDs; identity files for shared resources; `alchemy.run.ts` stays a roots-only manifest.
- **Tests:** integration tests are idempotent (unique IDs per run or reset-at-start) and runnable in dev mode; at least one test per milestone covering its riskiest behavior (e.g. the concurrent last-download race).

## Clarifications (Q&A)

- **Auth:** none — no login, passwords, or OAuth; users are anonymous. Out of scope by ruling.
- **Share format:** a URL (the ID embedded in a link), not a human-memorizable code. Since there is no auth, the link is a bearer token: your ID-scheme answer must cover guessability/enumeration, not just collisions. A short memorizable code is allowed as a deliberate deviation, but then the design must state the compensating controls (lookup rate limits, validity windows).
- **"Per-uploader" therefore means:** per whatever identity your design justifies (IP, self-minted upload key, cookie, …). If identities can be minted, your design must say what bottlenecks the minting. Rate limits (velocity) and quotas (accumulation) may use different keys.

## Review criteria (what I'll grade)

1. Right primitive for each job, with a defensible one-sentence reason.
2. Correctness under concurrency (the last-download race, the last-token race, double-scan).
3. Memory discipline (streaming end-to-end).
4. Error-channel design (tagged errors as API, orDie as bug policy).
5. Test quality (does the test suite fail if the race handling is removed?).
