import { readConfigFileSnapshot } from "../config/io.js";
import { resolveStateDir } from "../config/paths.js";
import type { ConfigFileSnapshot } from "../config/types.js";
import { resolveDatabaseEngineInput } from "../infra/database-engine/config.js";
import {
  getDatabaseEngineSelection,
  withDatabaseEngineInput,
  type DatabaseEngineSelection,
} from "../infra/database-engine/context.js";
import { assertDatabasePortStartupAllowed } from "../infra/database-port-recovery.js";

/** Direct servers and embedded kernels enter before locks, state reads, or plugin config. */
export async function withGatewayDatabaseEngine<T>(
  snapshot: ConfigFileSnapshot | undefined,
  operation: () => Promise<T>,
  selection?: DatabaseEngineSelection,
): Promise<T> {
  if (getDatabaseEngineSelection()) {
    return operation();
  }
  assertDatabasePortStartupAllowed(resolveStateDir(process.env));
  if (selection) {
    return withDatabaseEngineInput(selection.input, operation);
  }
  const selected =
    snapshot ?? (await readConfigFileSnapshot({ observe: false, pluginValidation: "core-only" }));
  const input = await resolveDatabaseEngineInput(selected.config);
  return withDatabaseEngineInput(input, operation);
}
