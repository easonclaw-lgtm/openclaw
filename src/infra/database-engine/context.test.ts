import { expect, it } from "vitest";
import { getDatabaseEngineSelection, withDatabaseEngineInput } from "./context.js";

it("retains independent immutable selections across overlapping owners", async () => {
  const input = { connection: "postgresql://localhost/synthetic", schemaPrefix: "test" };
  const [postgres, sqlite] = await Promise.all([
    withDatabaseEngineInput(input, async () => {
      await Promise.resolve();
      const selected = getDatabaseEngineSelection();
      expect(selected?.input).toBe(input);
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen(selected)).toBe(true);
      return selected?.input;
    }),
    withDatabaseEngineInput(undefined, async () => {
      await Promise.resolve();
      expect(getDatabaseEngineSelection()).toEqual({ input: undefined });
      return getDatabaseEngineSelection()?.input;
    }),
  ]);
  expect(postgres).toBe(input);
  expect(sqlite).toBeUndefined();
  expect(getDatabaseEngineSelection()).toBeUndefined();
});
