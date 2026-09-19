import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/durable-objects/schema/user.schema.ts",
  out: "./drizzle/user",
});
