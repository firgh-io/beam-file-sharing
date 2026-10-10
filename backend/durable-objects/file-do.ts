import * as Cloudflare from "alchemy/Cloudflare";
import type { FileDOShape } from "./file-do.live";

export class FileDO extends Cloudflare.DurableObject<FileDO, FileDOShape>()(
  "FileDO",
) {}
