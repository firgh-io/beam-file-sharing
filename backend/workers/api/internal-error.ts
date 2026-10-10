import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";

const describeDefect = (defect: unknown) =>
  defect instanceof Error ? (defect.stack ?? defect.message) : String(defect);

type ErrorClass = abstract new (...args: any[]) => unknown;

const describeFailure = (error: unknown) => {
  const detail =
    error instanceof Error
      ? JSON.stringify(error, Object.getOwnPropertyNames(error))
      : JSON.stringify(error);
  return {
    tag: (error as { _tag?: unknown } | null)?._tag,
    name: (error as { name?: unknown } | null)?.name,
    detail: detail?.slice(0, 2000) ?? String(error),
  };
};

export const logUndeclaredFailure =
  (operation: string, declared: ReadonlyArray<ErrorClass>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.tapError(effect, (error) =>
      declared.some((errorClass) => error instanceof errorClass)
        ? Effect.void
        : Effect.logError(
            `${operation} failed with an undeclared error: ${JSON.stringify(describeFailure(error))}`,
          ),
    );

export const respondToDefect = (defect: unknown) => {
  if (HttpServerResponse.isHttpServerResponse(defect)) {
    return Effect.succeed(defect);
  }

  return Effect.gen(function* () {
    const errorId = crypto.randomUUID();
    yield* Effect.logError(
      `Unhandled defect ${errorId}: ${describeDefect(defect)}`,
    );

    return HttpServerResponse.jsonUnsafe(
      {
        _tag: "InternalServerError",
        id: errorId,
        message: "Something went wrong",
      },
      { status: 500 },
    );
  });
};
