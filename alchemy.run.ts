import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Bucket } from "./backend/r2/bucket";
import Worker from "./backend/workers/worker";

export default Alchemy.Stack(
  "NewApp",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },

  Effect.gen(function* () {
    const bucket = yield* Bucket;
    const worker = yield* Worker;

    return {
      bucketName: bucket.bucketName,
      url: worker.url,
    };
  }),
);
