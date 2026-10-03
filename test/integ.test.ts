import * as HttpClient from "effect/http/HttpClient";
import * as Test from "alchemy/Test/Bun";
import { expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import Stack from "../alchemy.run";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

const { test, beforeAll, deploy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  dev: true,
});

const stack = beforeAll(deploy(Stack));

test(
  "Counter persists per key",
  Effect.gen(function* () {
    const { url } = yield* stack;

    // Reset foo

    yield* HttpClient.del(`${url}/counter/foo`);
    yield* HttpClient.del(`${url}/counter/bar`);

    const foo1 = yield* HttpClient.post(`${url}/counter/foo`);
    expect(yield* foo1.json).toEqual({ currentCount: 1 });

    const foo2 = yield* HttpClient.post(`${url}/counter/foo`);
    expect(yield* foo2.json).toEqual({ currentCount: 2 });

    const bar1 = yield* HttpClient.post(`${url}/counter/bar`);
    expect(yield* bar1.json).toEqual({ currentCount: 1 });
  }),
);

test(
  "tick stream 5 sequential values",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const response = yield* HttpClient.get(`${url}/tick/5`);
    const lines = yield* response.stream.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.runCollect,
    );
    expect([...lines]).toEqual(["0", "1", "2", "3", "4"]);
  }),
);
