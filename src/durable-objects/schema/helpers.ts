import { text } from "drizzle-orm/sqlite-core";

export const timestamps = {
  updatedAt: text("updated_at"),
  createdAt: text("created_at")
    .$defaultFn(() => new Date().toISOString())
    .notNull(),
  deletedAt: text("deleted_at"),
};
