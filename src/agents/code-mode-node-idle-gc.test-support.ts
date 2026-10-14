import { Session } from "node:inspector/promises";
import { syncBuiltinESMExports } from "node:module";
import vm from "node:vm";

let collections = 0;
// oxlint-disable-next-line typescript/unbound-method -- Reflect.apply preserves the inspector session receiver.
const post = Session.prototype.post;
Object.defineProperty(Session.prototype, "post", {
  value(this: Session, method: string, ...params: unknown[]) {
    if (method === "HeapProfiler.collectGarbage") {
      collections++;
    }
    return Reflect.apply(post, this, [method, ...params]);
  },
});
vm.Script = class extends vm.Script {
  override runInContext(...args: Parameters<vm.Script["runInContext"]>) {
    args[0].idleCollectionRequests = () => collections;
    return super.runInContext(...args);
  }
};
syncBuiltinESMExports();
await import("./code-mode-node.worker.js");
