import { asOptionalRecord } from "@openclaw/normalization-core/record-coerce";

const serializedArrays = new WeakMap<readonly unknown[], string>();

/** Own the optional payload field, including JSON omission, before socket fanout. */
export class SerializedJsonPayload {
  readonly bytes: Uint8Array;

  constructor(payload: unknown) {
    const frame = serializeGatewayFrame({ type: "res", payload });
    const bytes = typeof frame === "string" ? Buffer.from(frame) : frame;
    this.bytes = bytes.subarray('{"type":"res"'.length, -1);
  }

  toJSON(): unknown {
    if (this.bytes.byteLength === 0) {
      return undefined;
    }
    return JSON.parse(
      Buffer.from(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
        .subarray(',"payload":'.length)
        .toString("utf8"),
    );
  }
}

/** Register an immutable RPC array with its owner's already encoded row bytes. */
export function registerSerializedJsonArray<T>(
  values: readonly T[],
  encodedRows: readonly string[],
): readonly T[] {
  serializedArrays.set(values, `[${encodedRows.join(",")}]`);
  return values;
}

function arrayJson(value: unknown): string | Uint8Array | undefined {
  return value instanceof SerializedJsonArray
    ? value.bytes
    : Array.isArray(value)
      ? serializedArrays.get(value)
      : undefined;
}

/** The history worker owns these already-validated JSON array bytes. */
export class SerializedJsonArray {
  constructor(readonly bytes: Uint8Array) {}

  materialize(): unknown[] {
    const { bytes } = this;
    const value: unknown = JSON.parse(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8"),
    );
    if (!Array.isArray(value)) {
      throw new TypeError("Serialized history JSON must contain an array");
    }
    return value;
  }

  toJSON(): unknown[] {
    return this.materialize();
  }
}

function fieldJson(key: string, value: unknown): string {
  // The wrapper preserves toJSON's field name and ordinary undefined omission.
  return JSON.stringify({ [key]: value }).slice(1, -1);
}

export function serializeGatewayFrame(value: unknown): string | Buffer {
  const frame = asOptionalRecord(value);
  const sharedPayload = frame?.type === "res" ? frame.payload : undefined;
  if (
    frame &&
    sharedPayload instanceof SerializedJsonPayload &&
    typeof frame.toJSON !== "function"
  ) {
    const envelope = Object.fromEntries(Object.entries(frame).filter(([key]) => key !== "payload"));
    return Buffer.concat([
      Buffer.from(JSON.stringify(envelope).slice(0, -1)),
      sharedPayload.bytes,
      Buffer.from("}"),
    ]);
  }
  const payload = frame?.type === "res" ? asOptionalRecord(frame.payload) : undefined;
  // Subscription admission nests the same list response one level below payload.
  const list = payload && asOptionalRecord(Object.getOwnPropertyDescriptor(payload, "list")?.value);
  const arrayOwner = [payload, list].find(
    (record) =>
      record &&
      typeof record.toJSON !== "function" &&
      Object.keys(record).some((key) =>
        arrayJson(Object.getOwnPropertyDescriptor(record, key)?.value),
      ),
  );
  if (
    !frame ||
    !payload ||
    typeof frame.toJSON === "function" ||
    typeof payload.toJSON === "function" ||
    !arrayOwner
  ) {
    return JSON.stringify(value);
  }
  const chunks: (string | Uint8Array)[] = [];
  let hasBytes = false;
  const appendObject = (record: Record<string, unknown>): void => {
    chunks.push("{");
    let separator = "";
    for (const key of Object.keys(record)) {
      const field = record[key];
      const rawArray = record === arrayOwner ? arrayJson(field) : undefined;
      const nestedPayload =
        field === payload ? payload : field === arrayOwner ? arrayOwner : undefined;
      const encoded = rawArray || nestedPayload ? `${JSON.stringify(key)}:` : fieldJson(key, field);
      if (!encoded) {
        continue;
      }
      chunks.push(`${separator}${encoded}`);
      separator = ",";
      if (rawArray) {
        chunks.push(rawArray);
        hasBytes ||= typeof rawArray !== "string";
      } else if (nestedPayload) {
        appendObject(nestedPayload);
      }
    }
    chunks.push("}");
  };
  appendObject(frame);
  return hasBytes
    ? Buffer.concat(chunks.map((chunk) => (typeof chunk === "string" ? Buffer.from(chunk) : chunk)))
    : chunks.join("");
}
