import * as Cloudflare from "alchemy/Cloudflare";
import type { UserDOShape } from "./user-do.live";

export class UserDO extends Cloudflare.DurableObject<UserDO, UserDOShape>()(
  "UserDO",
) {}
