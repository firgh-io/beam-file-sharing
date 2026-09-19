# Alchemy Notes

Working notes on how Alchemy (Infrastructure-as-Effects) works and the conventions to follow in this repo.
Companion deep-dive with diagrams: https://claude.ai/code/artifact/e225b438-a3c0-459d-a403-a0a4d8633134

## The three worlds

The same program is executed by different interpreters, and `yield*` means something different in each:

1. **Synthesis (laptop, `alchemy deploy`)** — the CLI runs the stack program once as a *dry run*. Every `yield* SomeResource` just registers a row in an in-memory spec. Unknown values (`bucket.bucketName`) become IOUs (lazy Output expressions). Zero cloud calls.
2. **Plan + Apply (laptop)** — the spec is diffed against the state store → create/update/delete list, ordered by the dependency graph (every IOU is an arrow). Providers call the real Cloudflare API; results redeem the IOUs and are written back to state. Your program is NOT re-run here — its output is executed.
3. **Runtime (Cloudflare)** — the same worker file, bundled with `__ALCHEMY_RUNTIME__ = true` (deploy-only branches are dead-code-eliminated), boots once and serves. Binding yields now return live clients over `env`.

## Mental model

- **Declaring a resource does nothing.** `Cloudflare.R2.Bucket("Bucket")` is a lazy value. Only *yielding* it (from something reachable) registers it.
- **Sharing the value is the wiring.** Both `alchemy.run.ts` and `worker.ts` import the same `Bucket` const — that shared identity is how Alchemy knows the Worker binds to that bucket. No `link:` config exists.
- **Reachability = deployment.** Everything reachable from the stack program's yields (transitively, through workers' dry runs and bindings) gets deployed.
- **Dual-phase bindings.** `yield* ReadWriteBucket(Bucket)` records an `r2_bucket` binding in the spec at deploy time, and wraps `env["Bucket"]` in a typed client at runtime. One line, two personalities.

## Project structure

```
src/
  storage.ts        # resource identities only (buckets, queues) — one line each
  api.worker.ts     # one file per worker
  jobs.worker.ts
alchemy.run.ts      # composition root: providers, state, stack outputs
```

## What to yield in alchemy.run.ts

Only the **roots** — resources nothing else references:

- A worker that binds other workers/queues/buckets pulls them in transitively. Don't repeat them.
- **Queue consumers are roots.** A queue does not know its consumers — the Consumer subscription is declared inside the consuming worker, so that worker must be yielded explicitly or it (and its subscription) never deploys.
- Cron workers, standalone services: also roots.
- Yield a non-root resource only to read its attributes for stack **outputs** (e.g. `bucket.bucketName`).

```ts
Effect.gen(function* () {
  const api = yield* Orchestrator;          // pulls in JobA, JobB, the queue
  yield* Effect.all([JobC, CronWorker]);    // unreferenced roots
  return { url: api.url };
})
```

## Logical IDs

- The string ID (`"Bucket"`, `"Api"`) is the resource's **persistent identity** in the state store (as an FQN). Keep it a stable literal; never compute it.
- Renaming an ID = plan says delete + create. For data-bearing resources that destroys data. Use `.pipe(renamedFrom("OldId"))` to migrate state instead.
- Removing the last reference to a deployed resource schedules its **deletion** on the next deploy. Set `retain()` / RemovalPolicy on resources whose data must survive.
- The declaration site is the only place the string appears — everywhere else, reference the exported value. No separate ID-constants file needed.

## Worker anatomy

```ts
export default Cloudflare.Worker("Api", { main: import.meta.url },
  Effect.gen(function* () {
    // OUTER HALF — runs at deploy (dry run) and at boot (once per isolate).
    // Bind capabilities here. No per-request work.
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Bucket);

    return {
      // INNER HALF — handlers, run per event on a fresh fiber.
      fetch: Effect.gen(function* () { ... }),
    };
  }).pipe(Effect.provide([Cloudflare.R2.ReadWriteBucketBinding])),
);
```

- **Reserved handler keys** (the platform calls you): `fetch`, `scheduled`, `queue`, `email`, `tail`, `trace`, `tailStream`, `test`.
- **Every other key** in the returned object becomes an RPC method (name it whatever you want); other workers call it via `bindWorker`.
- **Class form** (`class JobA extends Cloudflare.Worker<JobA, Shape>()(...)`) — use when other workers call this one via RPC: the one name works as both value and type, `Shape` declares the method signatures, and importers can tree-shake the implementation. Fetch-only workers: plain form is fine.

## Capabilities vs helpers

| Kind | Examples | Needs `Effect.provide`? |
|---|---|---|
| Capability (named for the **access granted**) | `R2.ReadBucket` / `WriteBucket` / `ReadWriteBucket`, `Queues.WriteQueue`, `Workers.Fetch` | Yes — pair with its `…Binding` layer (`ReadWriteBucket` ↔ `ReadWriteBucketBinding`) |
| Helper (named for **what it does**) | `Workers.bindWorker`, `Queues.consumeQueueMessages` | No |

- One `.pipe(Effect.provide([...]))` per worker covers all its capabilities.
- Don't memorize the pairing — a missing layer is a compile error naming the missing service.
- Capabilities encode least privilege: `ReadBucket` wires read-only access and the client has no `put`.
- `consumeQueueMessages(queue, opts, handler)` wires BOTH halves of a consumer: the runtime `queue` handler and the deploy-time Consumer subscription. Hand-rolling `{ queue: ... }` means also declaring `Queues.Consumer(...)` yourself.

## The three layers behind each capability

Each capability tag ships one implementation per world the code might run in — the layer must match where the code executes, it is not a behavior switch:

| | `…Binding` | `…Http` | `…Local` |
|---|---|---|---|
| Code runs | inside a deployed Worker | standalone script/test → real cloud | deploy-time Effects (Actions), `alchemy dev` |
| Reaches R2 via | native `env["Bucket"]` binding | Cloudflare REST API | real name → REST API; `dev:` name → local emulator |
| Auth | the binding itself (wired by Cloudflare) | mints a scoped API-token resource with exactly the capability's permissions | current CLI credentials |
| Deploy side effect | registers the worker binding | registers the token + policy | none — registers no binding |

Deploying a worker with `Local` instead of `Binding` therefore *removes* the r2_bucket binding from the worker (the deploy branch that registers it never runs) and the runtime client fails (no CLI credentials inside an isolate). Least privilege survives the transport: `ReadBucket` is read-only over every layer.

## Testing

The prod worker keeps `Effect.provide(ReadWriteBucketBinding)` untouched. You isolate tests by **stage or mode**, not by rewiring layers:

- **Integration tests — `alchemy/Test/Bun`** (there is a bun:test adapter): `Test.make({ providers, stage?, dev? })` gives `test`/`deploy`/`destroy`. It deploys the real stack to an isolated **stage** (default `"test"`) — same logical IDs, separate physical resources, prod untouched.
- **`dev: true`** (or `ALCHEMY_TEST_DEV=1`) runs the same tests against local providers instead of the cloud: workers in local workerd, buckets/queues emulated. No cloud calls at all.
- **Unit tests of handler logic**: export the *un-provided* program (the Effect that still requires `ReadWriteBucket`), pipe `provide(ReadWriteBucketBinding)` only in the worker file, and provide a stub/`Local` layer in the test. Once an effect has been piped through `provide`, the requirement is discharged and cannot be overridden from outside — so keep shared logic un-provided and provide at each edge.
- **Scripts / seed Actions** against real buckets: `ReadWriteBucketLocal` (CLI creds) or `ReadWriteBucketHttp` (minted scoped token).

## Choosing communication

| Need | Tool |
|---|---|
| Answer required now (request/response) | `bindWorker(JobA)` → typed RPC over a service binding |
| Just needs to happen, reliably (fire-and-forget) | Queue: `WriteQueue(q).send(msg)` + consumer. Durable, batched, retried, dead-lettered |
| Multi-step, retries per step, long waits, must-not-rerun | Cloudflare Workflow (`step.do` / `step.sleep` / `step.waitForEvent`), checkpointed |

Do NOT fire-and-forget by calling RPC without awaiting: isolates (V8 sandboxes running workers) are ephemeral and evictable — un-awaited in-flight work dies with them. Queues own delivery outside the isolate.

## SQLite in Durable Objects

- Nothing to configure: every new DO class is registered with Cloudflare as a SQLite-backed class (`new_sqlite_classes`, see `WorkerProvider.ts`). The `sqlite?` prop is commented out — there is no opt-out.
- Access it through `state.storage.sql` (Effect wrapper in `Workers/DurableObjectStorage.ts`). `sql.exec<Row>(query, ...bindings)` returns an `Effect<SqlCursor<Row>>`; the cursor is an Effect `Stream` and also has `toArray()`, `one()`, `next()`, `raw()`, `columnNames`, `rowsRead`, `rowsWritten`. `sql.databaseSize` and `sql.raw` (the native binding) are plain properties.
- Two-phase rule applies: `yield* Cloudflare.DurableObjectState` in the outer Effect, every `exec` in the inner one (`RuntimeContext`-colored).
- Schema init goes at the top of the inner Effect with `CREATE TABLE IF NOT EXISTS`. The inner Effect runs once per in-memory instance under `blockConcurrencyWhile`, so no request sees a missing table. Alchemy does exactly this in `Workers/ScheduledEvents.ts`.
- Why the inner Effect: the outer one also runs at plan time on your laptop with a fake state (`{ storage: {} }`, see `DurableObject.ts` ~L1244) purely to discover bindings, so real storage calls there would crash `alchemy deploy`. The types enforce it: `exec` requires `RuntimeContext`, which the outer Effect is not allowed to require. At runtime the bridge (`DurableObjectBridge.ts` ~L64) runs outer then inner inside the constructor under `blockConcurrencyWhile`, so the top of the inner Effect is "once per activation", and the returned methods are "once per call".
- Query layers, from most to least integrated (all verified in `node_modules`):
  1. `alchemy/Drizzle/Cloudflare` → `yield* Drizzle.DurableObject({ migrations, relations })` in the inner Effect. Effect-native Drizzle (`drizzle-orm/effect-sqlite-do`): every query is an Effect with a typed `EffectDrizzleQueryError`; migrations from `drizzle-kit generate` (`driver: "durable-sqlite"`) run before the db is returned, failures die. Optional peer deps, pinned in alchemy's package.json: `drizzle-orm@1.0.0-rc.5-ab785fc`, `drizzle-kit@1.0.0-rc.5-ab785fc`. Not installed here yet. Do NOT hand-wrap `drizzle-orm/durable-sqlite` in `Effect.promise` — this module already does it properly.
     Schema file: `sqliteTable(...)` from `drizzle-orm/sqlite-core` plus `defineRelations({ ...tables }, (r) => ({ ... }))` from `drizzle-orm` (v1 relations API — `r.one.<table>({ from, to })`, `r.many.<table>()`), exported from the same file. Pass `relations` (not `schema`) to `Drizzle.DurableObject`; it carries the tables, so `db.query.<table>.findMany({ with })` works. `.references()` is optional for relations and only adds a real FK constraint. A per-entity DO already *is* the entity: don't model a `users` table inside the `User` DO, model that user's children.
     Layout: `drizzle.config.ts` at repo root (drizzle-kit's default lookup), `out: "./drizzle/<do-name>"` so each DO class keeps its own migration history, `migrations.js` in that folder is the default export you pass in. Only `drizzle-kit generate` is used — `migrate`/`push` need a DB connection and don't apply; migrations run inside the DO at activation. The generated `migrations.js` imports `.sql` files as text; Alchemy's rolldown bundler already maps `.sql` to `text` (`Bundle/Bundle.ts`), so no loader config. Second DO with tables → second config file, run with `drizzle-kit generate --config <path>`.
     Auto-migrations: `Drizzle.Schema` (`alchemy/Drizzle`) is a deploy-time resource that runs drizzle-kit generate when the schema changes, but its output (`{out}/{timestamp}_migration/migration.sql`) is only consumed by database resources with a `migrations` prop (D1, Neon, Fly Postgres) that apply SQL at deploy. Nothing consumes it for Durable Objects: a DO namespace is many databases that only exist when an instance wakes, so migrations must ship inside the worker bundle (`migrations.js`) and run at activation. For DOs, `drizzle-kit generate` stays a manual/pre-deploy step; chain it in a `deploy` script if wanted.
  2. `@effect/sql-sqlite-do` (already in node_modules as a transitive dep, 4.0.0-rc.112, add it explicitly before importing). Effect's `SqlClient`: `sql\`SELECT … ${param}\`` tagged templates, typed `SqlError`, `withTransaction` backed by `storage.transaction` (only when you pass `{ storage }`, not `{ db }`), plain-SQL migrator (`SqliteMigrator.run`). Build with `Layer.build(SqliteClient.layer({ storage: state.raw.storage }))` in the inner Effect. This is what option 1 is built on.
  3. Raw `state.storage.sql.exec` — zero deps, covered above.
  4. Kysely + community `kysely-do` (`new DODialect({ ctx: state.raw })`) — promise-based, wrap in `Effect.promise`; no Effect integration.
  - Prisma has no Durable Object adapter (only `@prisma/adapter-d1` for D1).
- `storage.get/put` (the KV API) still works on a SQLite DO — the Counter uses it. Pick SQL when the data is relational or needs querying.
- Not wrapped: `transactionSync`. Reach it via `state.raw.storage.transactionSync(() => { state.storage.sql.raw.exec(...) })` — the callback must stay synchronous.
- Cloudflare gotchas: consume a cursor before the next async boundary (call `toArray()` right after `exec`); in a multi-statement `exec`, bindings and the returned cursor apply only to the last statement.

## Gotchas

- The outer half of every reachable worker executes during synthesis on your laptop. Keep it to binding declarations — arbitrary side effects there run on every `alchemy deploy`.
- In-request orchestration (A → B inside one `fetch`) has no checkpointing: a mid-chain crash means the caller retries from scratch and step A runs twice. Reach for a Workflow when that's unacceptable.
- Effect fundamentals under it all: yields are interpreted by the running fiber's context (that's how one line means two things), typed errors stay in the type until handled (`catchTag`), and `Effect.provide` fills the context map — the compiler refuses to run a program with unmet requirements.

## Version pins (this repo)

`alchemy@2.0.0-beta.74` · `effect@4.0.0-rc.112` — both pre-release; APIs may shift. Source of truth: `node_modules/alchemy/src/**` (readable TypeScript) and https://alchemy.run/llms.txt.
