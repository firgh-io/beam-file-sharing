import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/durable-objects/schema/file.schema.ts",
  out: "./drizzle/file",
});
