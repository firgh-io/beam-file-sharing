import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { logUndeclaredFailure, respondToDefect } from "./internal-error";

test("an unexpected error becomes a 500 with a reference id and no internals", async () => {
  const response = await Effect.runPromise(
    respondToDefect(new Error("secret db password in stack")),
  );
  const web = HttpServerResponse.toWeb(response);
  const text = await web.text();
  const body = JSON.parse(text);

  expect(web.status).toBe(500);
  expect(body._tag).toBe("InternalServerError");
  expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(text).not.toContain("secret");
  expect(text).not.toContain("stack");
});

test("a response thrown as a defect is returned unchanged", async () => {
  const original = HttpServerResponse.text("teapot", { status: 418 });

  const response = await Effect.runPromise(respondToDefect(original));

  expect(response).toBe(original);
});

class Declared extends Error {}

test("logging undeclared failures leaves the original failure untouched", async () => {
  const declared = new Declared("expected");
  const undeclared = new Error("surprise");
  const observe = (failure: Error) =>
    Effect.runPromise(
      Effect.flip(
        Effect.fail(failure).pipe(logUndeclaredFailure("op", [Declared])),
      ),
    );

  expect(await observe(declared)).toBe(declared);
  expect(await observe(undeclared)).toBe(undeclared);
});
