import * as Cloudflare from "alchemy/Cloudflare";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Effect from "effect/Effect";
import { Bucket } from "../r2/bucket";
import Counter from "../durable-objects/counter";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { RuntimeContext } from "alchemy/RuntimeContext";
import * as Stream from "effect/Stream";

interface R2ErrorLike {
  readonly _tag: "R2Error";
  readonly message: string;
}

const r2ErrorTo500 = (error: R2ErrorLike) =>
  Effect.succeed(HttpServerResponse.text(error.message, { status: 500 }));

export default Cloudflare.Worker(
  "Worker",
  {
    main: import.meta.url,
  },
  Effect.gen(function* () {
    const bucket = yield* Cloudflare.R2.ReadWriteBucket(Bucket);
    const counters = yield* Counter;

    const router = yield* HttpRouter.make;

    yield* router.add(
      "POST",
      "/counter/:name",
      Effect.gen(function* () {
        const { name } = yield* HttpRouter.params;
        const next = yield* counters.getByName(name!).increment();
        return yield* HttpServerResponse.json({ currentCount: next });
      }).pipe(Effect.provide(RuntimeContext.phantom), Effect.orDie),
    );

    yield* router.add(
      "DELETE",
      "/counter/:name",
      Effect.gen(function* () {
        const { name } = yield* HttpRouter.params;
        yield* counters.getByName(name!).reset();
        return HttpServerResponse.empty({ status: 204 });
      }).pipe(Effect.provide(RuntimeContext.phantom), Effect.orDie),
    );

    yield* router.add(
      "GET",
      "/tick/:countMax",
      Effect.gen(function* () {
        const { countMax } = yield* HttpRouter.params;
        const stream = counters
          .getByName("tick")
          .tick(Number(countMax!))
          .pipe(
            Stream.map((i) => `${i}\n`),
            Stream.encodeText,
          );
        return HttpServerResponse.stream(stream, {
          headers: { "content-type": "text/plain" },
        });
      }).pipe(Effect.provide(RuntimeContext.phantom), Effect.orDie),
    );

    yield* router.add("PUT", "/:key", (req) =>
      Effect.gen(function* () {
        const { key } = yield* HttpRouter.params;
        yield* bucket.put(key!, req.stream, {
          contentLength: Number(req.headers["content-length"] ?? 0),
        });
        return HttpServerResponse.empty({ status: 201 });
      }).pipe(
        Effect.catchTag("R2Error", r2ErrorTo500),
        Effect.provide(RuntimeContext.phantom),
        Effect.orDie,
      ),
    );

    yield* router.add(
      "GET",
      "/:key",
      Effect.gen(function* () {
        const { key } = yield* HttpRouter.params;
        const object = yield* bucket.get(key!);
        if (object === null)
          return HttpServerResponse.text("Not Found", { status: 404 });
        return HttpServerResponse.text(yield* object.text());
      }).pipe(
        Effect.catchTag("R2Error", r2ErrorTo500),
        Effect.provide(RuntimeContext.phantom),
        Effect.orDie,
      ),
    );

    return {
      fetch: router
        .asHttpEffect()
        .pipe(
          Effect.catchCause(() =>
            Effect.succeed(
              HttpServerResponse.text("Internal Error", { status: 500 }),
            ),
          ),
        ),
    };
  }).pipe(Effect.provide([Cloudflare.R2.ReadWriteBucketBinding])),
);
