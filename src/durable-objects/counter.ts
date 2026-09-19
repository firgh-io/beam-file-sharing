import * as Cloudflare from "alchemy/Cloudflare";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

export default class Counter extends Cloudflare.DurableObject<Counter>()(
  "Counter",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      let count = (yield* state.storage.get<number>("count")) ?? 0;
      return {
        increment: () =>
          Effect.gen(function* () {
            count += 1;
            yield* state.storage.put("count", count);
            return count;
          }),
        decrement: () =>
          Effect.gen(function* () {
            count -= 1;
            yield* state.storage.put("count", count);
            return count;
          }),
        reset: () =>
          Effect.gen(function* () {
            count = 0;
            yield* state.storage.put("count", count);
          }),
        tick: (n: number) =>
          Stream.iterate(0, (i) => i + 1).pipe(
            Stream.take(n),
            Stream.schedule(Schedule.spaced("100 millis")),
          ),
        get: () => Effect.succeed(count),
      };
    });
  }),
) {}
