import { AsyncLocalStorage } from "node:async_hooks";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import type { DatabaseEngineInput } from "./types.js";

export type DatabaseEngineSelection = Readonly<{ input: DatabaseEngineInput }>;

const selections = resolveGlobalSingleton(
  Symbol.for("openclaw.databaseEngineSelection"),
  () => new AsyncLocalStorage<DatabaseEngineSelection>(),
);

/** An explicit SQLite selection is distinct from an entry point awaiting config. */
export function getDatabaseEngineSelection() {
  return selections.getStore();
}

/** Retain one host-resolved selection through this owner's asynchronous lifetime. */
export function withDatabaseEngineInput<T>(input: DatabaseEngineInput, operation: () => T): T {
  return selections.run(Object.freeze({ input: input && Object.freeze(input) }), operation);
}

export function assertSameDatabaseEngineInput(
  previous: DatabaseEngineInput,
  next: DatabaseEngineInput,
): void {
  if (previous?.connection !== next?.connection || previous?.schemaPrefix !== next?.schemaPrefix) {
    throw new Error("Shared-state database engine changed; close its owner first");
  }
}
