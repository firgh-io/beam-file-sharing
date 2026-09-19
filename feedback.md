# Design Review Feedback — Beam

## Iteration 1

Reviewed: `design-doc.md` + `sysdesign.excalidraw.svg` (draft of 2026-09-02). Ordered by severity. Hints are nudges, not answers — the design stays yours.

<!-- ### 1. Your identity scheme can be faked by anyone
FingerprintJS runs in the user's browser. That means the "identity" it produces is whatever the user's machine chooses to send you. Someone using curl never runs your JS at all — they can send any fingerprint, or a new one per request. Your quota, your rate limit, and the `userId` field all depend on this value, so all of them can be reset at will. Side problems: fingerprinting has GDPR issues, and two strangers with similar browsers can collide into one shared quota. -->

> **Hint:** the spec says it plainly: "your design must say what bottlenecks the minting." You can throttle identities that _your server_ hands out. You can't throttle identities the client invents. What can the server mint, and what does the server itself observe (like the connecting IP) that could throttle the minting?

<!-- ### 2. Presigned uploads mean you never see the file — so you can't enforce size
With a presigned URL, the file goes straight from the browser to R2. Your worker only ever sees the size the client *claims* (`fileSizeInByte`). Nothing checks the claim. I can declare 1 KB and upload 100 MB. The spec also requires the size cap to be enforced *before* the file is fully stored — right now, nobody does that. Separate question: have you checked that presigned R2 URLs are even workable through Alchemy/Effect, or is this a pattern borrowed from AWS tutorials on faith? -->

> **Hint:** two honest options. (a) Keep presigned URLs, but find out what the signature can pin down (content-length? expiry?) and verify the actual stored size at `/complete`. (b) Go back to streaming the file through the worker — your M1 code already did this, and the worker sees every byte. Both work. Pick one in writing, with the trade-off stated.

<!-- ### 3. `/complete` trusts the client three times -->

<!-- - Client never calls it → orphaned metadata and maybe orphaned bytes. Nothing cleans up. -->
<!-- - Client calls it without uploading (or before finishing) → your scanner picks up a file that doesn't exist. -->
<!-- - Nothing ties a fileId to its uploader → I can call `/complete` on someone else's file. -->

> **Hint:** give file metadata a lifecycle: `pending` → `stored` → `scanned`. With a timestamp, "stuck in pending too long" becomes something a cleanup job can find. For the ownership problem: the response to the first upload call can include a secret that `/complete` must send back. And don't trust the caller at all — check R2 yourself at complete time (does the object exist? what size is it really?).

<!-- ### 4. You wrote "availability over consistency" but your product disagrees

"Burns after 5 downloads" is a consistency feature. If two people grab the last download at the same moment, exactly one should win — that's the spec's mandatory question, and the doc doesn't answer it. Meanwhile the primitive you picked (DO) is the most consistency-focused thing Cloudflare offers. The NFR, the product, and the architecture are pointing in three directions. -->

> **Hint:** rewrite the NFR per piece of data, not for the whole system. Which numbers are allowed to be stale (stats, maybe) and which are never allowed to be stale (the download counter)? Once you write that down, the race question mostly answers itself — you just have to say where the counter lives so that decrements happen one at a time.

<!-- ### 5. Your diagram draws the DO as a database. It's not — it's many small actors

One "Cloudflare DO" box holding a User table and a File table. Read it both ways: if that's _one_ DO instance for everyone, every request in the system waits in line behind a single-threaded actor — there goes your availability. If it's _many_ instances, keyed by what? Per user? Per file? The doc doesn't say, and on this platform that's the single most important decision. -->

> **Hint:** the question is "one actor per \_\_\_." You already built one-actor-per-counter in this repo — foo and bar were two instances. What are the natural actor keys here, what data does each own, and which operations then get their serialization for free (see #4)? Remember: an actor can hold tables _inside_ it, but only for its own key's data.

<!-- ### 6. There is no download path in this document

The upload flow is described step by step. The download flow doesn't appear at all. Where is expiry checked? Who decrements the counter, and what makes that atomic? What's the difference between "this link never existed" (404) and "this link is dead" (410)? What happens on the last allowed download? This is most of your traffic and all of the hard concurrency, and it has zero sentences. -->

> **Hint:** narrate one GET request the same way you narrated the upload: request comes in → who checks the link is valid → who decrements → who serves the bytes → who kills the link after the last download. Writing the sequence down will force answers to #4 and #5.

<!-- ### 7. Your rate-limit requirement has no design behind it

"~10 uploads/min per user" appears once in the NFRs and never again. No component in the diagram, no algorithm, no home for the limiter's state. And it would presumably key off the fingerprint from #1, which makes it fake twice. -->

> **Hint:** the spec asks for the algorithm (fixed window / sliding window / token bucket) and for state that two simultaneous requests can't both slip past. "State that processes one request at a time" — you know something that does that (#5).

<!-- ### 8. The scan pipeline avoids its hard questions

Can someone download a file _before_ the scan finishes? Your flow implies yes, but never says it — the spec wants that answered on purpose, either way. What happens when the scan worker crashes mid-file and the queue redelivers — does scanning twice break anything? The webhook: the spec requires retries with backoff and a bounded number of attempts; your doc says "call the webhook," once. And nobody asked what stops a user registering `http://169.254.169.254/` (or your own internal endpoints) as their webhook — you'd be making your infrastructure attack itself (this is called SSRF). -->

> **Hint:** queues redeliver. Write every consumer step assuming it will run twice. For webhooks: if delivery is its own queue message instead of the tail end of the scan step, the queue's built-in retry/backoff/dead-letter machinery does most of the spec's work for you. For SSRF: validate the URL when it's registered, not when it's called.

<!-- ### 9. The API shapes are sloppy in ways that hide bugs

`UploadRequest` is actually a _response_ (it carries `presignedUrl` and `fileId`, which only the server can produce). `downloadCount` — is that the cap or how many remain? `int` isn't a TypeScript type. The interface says `expiry: Date`; the prose says the client sends a value plus a unit. `userId` in the body is problem #1 again. And the ID scheme — an explicit spec question — is missing entirely: `fileId` just appears out of nowhere. -->

> **Hint:** name pairs mechanically (`UploadInitRequest` / `UploadInitResponse`) and the confusion disappears. For IDs, a complete answer can be one sentence: who generates it, how many bits of randomness, and why collisions don't matter (or what happens when they do).

<!-- ### 10. The empty sections are where the real design was supposed to happen

"Data Flow" and "Error Handling" are empty headers. Those two sections are exactly where #3, #6, and #8 would have been forced into the open. Roughly 40% of the design — the hard 40% — is deferred. -->

> **Hint:** for Error Handling, a simple table gets you far: what fails → who notices → what the client sees (status code) → what cleans up. Any failure without a row is a failure the design hasn't met yet.

<!-- ---

### What's genuinely right

- Clean FR/NFR separation, with real numbers in the NFRs.
- Wanting to keep file bytes out of the worker (presigned) has a real motivation — it just needs to be argued and reconciled with enforcement (#2).
- Scan behind a queue. Webhook after the verdict, not after the upload. Deleting flagged bytes instead of just marking them.

### Bar for iteration 2

Answer at minimum: the last-download race (#4), the DO keying decision (#5), the identity bottleneck (#1), and the full download flow (#6). Those four force most of the rest.

--- -->

## Iteration 2

Reviewed: `design-doc.md` + `sysdesign.excalidraw.svg` (2026-09-03). Real progress: the download flow exists, the DO is keyed per user with justification, the identity trade-off is documented, no-download-before-verdict is decided and defended, statuses have a lifecycle. The findings below are mostly _interactions between your own mechanisms_ — the sign of a design that now has enough substance to contradict itself.

<!-- ### 1. Your share link leaks the uploader's identity secret (critical)
`fileId = {userId}-{randomString}`, and the share link contains the fileId. But the userId (the cookie value) is also your *only* authentication: `/complete` authorizes by matching cookie to the userId inside the fileId, and quota hangs off it. So every recipient of a share link can read the uploader's userId out of the URL, set their own cookie to it, and now: complete the victim's pending uploads, upload files billed to the victim's quota, impersonate them entirely. The identity key is secret; the fileId is public; you put one inside the other. -->

> **Hint:** an identifier the world sees and a credential only the owner holds must never be derivable from each other. You need the fileId→user lookup for routing — fine — but ask: does the _public_ ID need to contain the _raw_ userId, or just something that lets the server find the right DO without letting a reader recover the credential? Also unanswered from the clarifications: how many random bits in `randomString`? The link is a bearer token; guessability needs a number.

<!-- ### 2. The presigned download URL defeats burn-after-N

The download flow decrements in the DO (atomic — good, that's the race answered) and then returns an R2 presigned GET URL. But a presigned URL is reusable until it expires and works for anyone holding it. So: one decrement buys a URL that can be downloaded five times, or shared onward, or used by a script in a loop until TTL. Your signature feature — "burns after N downloads" — is enforced at _URL issuance_, not at _download_, and the two are not the same event. Also the inverse bug: a user who gets the URL but never uses it has consumed a download that never happened.

> **Hint:** ask what the decrement should be tied to — issuing permission, or serving bytes? If bytes, then whatever serves the bytes must be the thing that decrements (which reopens your streaming-vs-presigned decision, but for the _read_ path this time — note the bandwidth argument is much weaker for downloads if you want the count exact). If you keep presigned GETs, you owe: TTL choice, single-use reasoning (can you make one URL unusable after first use? verify, don't assume), and an honest "the count is approximate" line in the NFRs. -->

<!-- ### 3. Size is still not enforced before storage

You constrain the presigned URL's expiry and content-type — but not its **content-length**, which is the one that matters. The claimed size gates quota at init; the _actual_ size is only checked at scan time (step 3), after the bytes are fully in R2. That's exactly what M2 forbids ("before the file is fully stored, not after"). I can declare 1 KB, upload 100 MB, and it sits in your bucket until a queue consumer notices.

> **Hint:** research whether an R2 presigned PUT can sign the content-length header (S3-compatible signing can pin headers). If yes, the claim becomes enforceable at upload time and your scan-time check becomes a backstop. If no, that's a major point against presigned uploads and belongs in your trade-off section. -->

<!-- ### 4. Expired files stay downloadable until the cleanup fires

Download validity checks `status !== AVAILABLE`, and EXPIRED is only _set_ by the scheduled deletion job. Between the expiry timestamp and whenever that job runs, the file's status is still AVAILABLE — expired links keep working. The status flip is bookkeeping; the truth is `expires_at`.

> **Hint:** the download path already reads the file row inside the DO; compare `expires_at` to the clock right there. Statuses derived from time should be _computed_ on read, not only _stored_ on schedule — the stored flip is for cleanup, not for correctness. -->

<!-- ### 5. Your ERROR status and your idempotency guard deadlock each other

Consumer step 1: skip unless scan_status is PENDING. Step 5: on scan error, set scan_status = ERROR "so it can be retried." Error handling section: throw on failure so the queue redelivers. Trace it: scan fails → status ERROR → you throw → queue redelivers → step 1 sees ERROR ≠ PENDING → **skip**. ERROR files are never scanned again; the retry you designed is disabled by the guard you designed.

> **Hint:** decide which mechanism owns retries — the queue's redelivery (then don't flip the status out of the retryable set on transient failure) or your own status machine (then something must re-enqueue ERROR rows). One owner. Also state what the guard is _for_ (double-delivery of an already-CLEAN file) and check it still does that job after the fix. -->

<!-- ### 6. "Create a cronjob per file" isn't a thing on this platform — and you already use the right primitive elsewhere

Cloudflare cron triggers are static schedules on a worker; you can't mint one per file. Meanwhile your orphan cleanup correctly uses DO alarms. Two mechanisms are described where one exists. And the alarm route has a constraint the doc must face: **one alarm per DO instance**, but your DO is per-user and holds many files with different expiries. -->

> **Hint:** this is the spec's M4 question verbatim — per-file alarms vs periodic sweep, trade-offs stated. With a per-user DO, "alarm set to the earliest pending deadline, re-armed after firing" is one pattern; "coarse periodic sweep per DO" is another. Pick one on paper. And: when bytes are deleted (expiry, malware, mismatch), who decrements `usedBytes`? Right now quota only ever grows — after a week of churn every active user is "full."

<!-- ### 7. The checksum's origin is impossible as written

At upload-init "we calculate the file's checksum" — the server hasn't seen a single byte at init. This must mean the _client claims_ a checksum. Then scan-time compares actual vs claimed — which catches transfer corruption and lies, fine, but the doc should say what a mismatch _means_ (an attacker controls both the claim and the upload, so it's an integrity check, not a security check). Also M3 wants the SHA-256 the _server_ computed stored as truth.

> **Hint:** two checksums, two jobs: client-claimed (optional, transfer integrity) and server-computed at scan (authoritative, stored). Name both in the data model or drop the claim entirely and keep only the server's. -->

<!-- ### 8. API mechanics that won't survive first contact -->

<!-- - The upload-init response contains only `presignedUrl` — the client also needs the **fileId** to call `/complete` and to build anything at all. It's missing. -->

<!-- - `anon_id` as a request _header_ contradicts the http-only cookie: http-only means JS can't read it, so the client can't copy it into a custom header. Pick one transport — if it's an http-only cookie, it arrives as the `Cookie` header automatically and your API docs should say that. -->

<!-- - `expiry` max 7 days is a spec rule; nothing in the doc says the _server_ clamps it (client conversion is a convenience, not enforcement). Same for `maxDownloadCount ≥ 1`. -->

<!-- - Spec asked for 404-vs-410 semantics; you return 403 for expired. Defensible, but deviations from the spec get a sentence of justification, and "410 Gone" exists for exactly this. -->

<!-- ### 9. The SSRF check is a blocklist with one entry

"Not a local subnet (e.g. 192.168.x.x)" misses 10.0.0.0/8, 172.16/12, 127.0.0.1/localhost, 169.254.169.254 (the classic cloud-metadata target), IPv6 equivalents (::1, fc00::/7), and DNS names that _resolve_ to any of those (validation at registration time can be defeated by a DNS record that changes afterward — look up "DNS rebinding"). -->

> **Hint:** allowlists beat blocklists (https only, public DNS, optionally port 443 only), and the residual rebinding risk is worth one honest sentence rather than silence. Don't over-build it — but name what you're not defending.

<!-- ### 10. Smaller, still worth fixing -->

<!-- - The presigned-upload justification contains shaky claims: workers have no wall-clock "up time" limit on streaming a body, and the 100 MB figure is a _request body_ limit that varies by plan — the honest argument is bandwidth cost and worker-CPU billing, which you also state. Cut the wrong reasons; they weaken the right one. The iteration-1 question is also still open: verified that presigned R2 URLs are practical through your Alchemy/Effect stack?
- "Cloudflare rate limiter" is a fine choice, but the spec asked for the algorithm and the both-spend-the-last-token story: CF's binding is approximate and per-location — acceptable for velocity limiting, but _say_ it's approximate and why that's OK.
- `download_count - 1 < 0` reads as a countdown while the table has both `download_count` and `max_download_count` (a count-up). Pick one representation; off-by-one bugs live exactly here.
- The Cleanup section ends mid-sentence ("For files"), and "delete (or archive)" is an undecided fork — M4 requires actual deletion; archiving changes cost and privacy stories. -->

<!-- - Error Handling covers only scanning. The table from iteration 1's hint (what fails → who notices → client sees → who cleans up) is still owed for upload-init, upload-abandoned, `/complete`, and download. -->

<!-- ### What's genuinely right this round

- Download decrement inside the per-user DO: the last-download race has a correct home (its win is then leaked by #2 — fix the leak, keep the mechanism).
- Per-user DO keying with stated reasons; tables-inside-actor understood correctly.
- Identity weakness (cookie deletion) _documented as an accepted trade-off_ with a compensating control — this is exactly what design docs are for. (#1 is still fatal, but it's a different flaw than the one you accepted.)
- No-download-before-verdict: decided, justified, and it simplifies the state machine.
- Status lifecycle with `*_updated_at` timestamps — makes the orphan sweep possible, which you then actually designed.

### Bar for iteration 3

Fix #1 (identity leak) and #2/#3 (what presigned URLs actually enforce, on both paths) — those three decide whether the architecture holds. #4, #5, #6 are each one honest paragraph. After that, this is implementable. -->

---

## Iteration 3

Reviewed: `design-doc.md` + diagram (2026-09-03). Verdict up front: **the architecture holds.** Two-DO split with no identity in public tokens, size pinned into the presigned signature, downloads streamed so the decrement is tied to serving, expiry checked against the timestamp on read, the scan guard accepts ERROR, the rate-limiter approximation is documented with exactly the right velocity-vs-authoritative distinction, and the presigned justification now states correct facts. What remains: ordering bugs, one platform-constraint error, and one sentence you left unfinished — again, the hardest one.

<!-- ### 1. `/complete` moves quota before verifying the upload exists

The listed order: (1) user DO: `reserved -= size; used += size`, (2) HEAD R2 to verify existence and size, (3) statuses + queue. If the HEAD fails — object missing, size mismatch — the quota has already migrated to `used_byte` for a file that isn't there. Verify first, then commit. Also unspecified: what the client gets when HEAD fails (the `/complete` error table has only the 401), and what status the file lands in (back to AWAITING_UPLOAD so the sweep gets it? straight to DELETED?). -->

### 2. Upload-init reserves quota, then checks it — and never unreserves on rejection

"`reserved_byte += file_size`. Then, quota check." If the check fails you return 403 — with the reservation still on the books? Nothing says it's rolled back. Two clean shapes: check-then-reserve (free of races anyway — the User DO is single-threaded, so the check and the reserve in one RPC are atomic), or reserve-then-check with an explicit unreserve on the failure path. Say which.

### 3. A DO has ONE alarm — your File DO now claims two

"An additional cleanup alarm (separate from the expiry alarm)": the platform gives each DO instance exactly one alarm. This needs a redesign, and the per-file DO actually makes it elegant: at any moment a file has _one_ next deadline determined by its status (AWAITING*UPLOAD → created+3d; AVAILABLE → expires_at; QUARANTINED → quarantined+2d…). Every status transition re-arms the single alarm to the new deadline; the alarm handler acts per the status it finds. One mechanism, your whole config table, no second alarm. Also: a \_periodic* per-file alarm that re-arms forever would mean millions of no-op wakeups — deadline-armed, not interval-armed.

### 4. The unfinished sentence is the cross-actor consistency answer — the one the split-DO design owes most

"File DO deleted on cleanup but User DO is not updated — …Assuming we exhaust the retries, we need to" — ends there. This is the quota-drift hazard that choosing two DO classes bought you; it can't stay a sentence fragment. What's the recovery when the second actor's update permanently fails: accept bounded drift (defensible — say the bound, note the ≤7-day file lifetime caps it)? A reconciliation sweep? Ordering that makes the User-DO update the _first_ thing so failure leaves a recoverable state? Pick one and finish the paragraph.

### 5. The idempotency claim contradicts the design's own arithmetic

Error handling: "we don't have incremental/decremental RPC methods in each DO." The design: `reserved_byte += file_size`, `used_byte += file_size`, `download_count += 1`. What you actually built — and it's good — is _state-guarded transitions_: quota moves only on known status transitions, so a retried `/complete` can't double-apply. Say that; it's the real mechanism. And carve out `download_count` honestly: it's a plain counter, retried requests do increment it again, and that's _fine_ under your stated semantics ("streams authorized") — but it is not idempotent, so the blanket claim is false as written.

### 6. `file_blob_id` and the quarantine move are unexplained

`file_blob_id` appears in the schema and the presigned URL with no stated purpose (there's a good one available — decoupling the public id from the storage key — but the doc doesn't claim it). The R2 `active/ → quarantine/` move: R2 has no move — it's copy + delete, a full 100 MB copy — and the _reason_ is absent: status QUARANTINED already blocks downloads, so what does physically relocating bytes buy? (There are defensible answers — lifecycle rules on the prefix, blast-radius separation for presigned mistakes — but pick one or drop the move.)

### 7. Small but real

- `expires_at ≤ 7 days` is in the client validation list but not the server's — the one that matters.
- Webhook rules contradict: "only https" and "allow ports 80/443" — port 80 _is_ http. And from iteration 2, still open: names that _resolve_ to private IPs (DNS rebinding) — either add a resolution check or write the one-sentence residual-risk acceptance.
- File IDs are UUIDv7: fine, but the clarification asked for an entropy statement — v7 carries ~74 random bits plus a _timestamp_, so links leak creation time (harmless here, but say it) and 74 bits is your enumeration answer (sufficient — state it).
- `/complete` is 201 + shareable URL in the flow, 200 with no body in the API section. One truth.
- Still owed eventually (M4, not blocking): with per-file DOs there is no global index — per-user and admin stats need an aggregate-on-write design that doesn't exist yet.

### What's genuinely right this round

- The public-token/credential separation is now clean: `file_id` random, `owner_id` only ever derived from the http-only cookie.
- Content-length baked into the presigned signature + HEAD verification at complete: size is now enforced pre-storage _and_ audited post-storage.
- Streaming downloads with the decrement in the File DO and semantics stated ("streams authorized") — the burn feature is now enforceable _and_ honestly specified.
- `reserved_byte`/`used_byte` split: the two-phase quota lifecycle is the right shape; it just needs the ordering fixes (#1, #2).
- Scan guard admits PENDING _or_ ERROR — the iteration-2 deadlock is genuinely fixed, and webhook delivery as its own queued step with the workflow alternative noted is exactly the right reasoning.
- The rate-limiting section could be pasted into a real design doc at a real company. Approximate mechanism, stated honestly, with authority delegated to the transactional layer.

### Verdict

Fix #1–#4 (each is a paragraph, not a redesign) and this is implementable. You're cleared to start M1 while you polish: nothing in the remaining findings changes the component list, the API, or the data model.
