import {
  normalizeModelCatalog,
  normalizeModelCatalogProviderRows,
} from "@openclaw/model-catalog-core/model-catalog-normalize";
import { expectDefined } from "@openclaw/normalization-core";
import { describe, expect, it } from "vitest";
import manifest from "../../extensions/qwen/openclaw.plugin.json" with { type: "json" };
import { modelFromStaticCatalogRow } from "../agents/embedded-agent-runner/model.static-catalog-row.js";
import { OpenClawSchema } from "../config/zod-schema.js";
import { toLiveModelConfig } from "./gateway-models.profiles.live.model-config.test-helpers.js";

const catalog = expectDefined(
  normalizeModelCatalog(manifest.modelCatalog, { ownedProviders: new Set(["qwen"]) }),
  "Qwen catalog",
);
const providerCatalog = expectDefined(catalog.providers?.qwen, "Qwen provider catalog");
const row = expectDefined(
  normalizeModelCatalogProviderRows({ provider: "qwen", providerCatalog, source: "manifest" }).find(
    (model) => model.id === "qwen3.5-plus",
  ),
  "Qwen static fallback row",
);

describe("toLiveModelConfig", () => {
  it.each([
    undefined,
    "https://coding-intl.dashscope.aliyuncs.com/v1",
    "https://coding.dashscope.aliyuncs.com/v1",
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ])("serializes Qwen catalog rows with endpoint %s into valid config", (baseUrl) => {
    const model = modelFromStaticCatalogRow(row);
    const modelConfig = toLiveModelConfig(baseUrl ? { ...model, baseUrl } : model);
    const providerBaseUrl = baseUrl ?? "https://coding-intl.dashscope.aliyuncs.com/v1";
    const config = {
      models: {
        providers: {
          qwen: { api: model.api, baseUrl: providerBaseUrl, models: [modelConfig] },
        },
      },
    };
    const serialized = JSON.stringify(config);
    const parsed = OpenClawSchema.parse(JSON.parse(serialized));
    expect(parsed.models?.providers?.qwen?.baseUrl).toBe(providerBaseUrl);
    if (baseUrl) {
      expect(modelConfig.baseUrl).toBe(baseUrl);
    } else {
      expect(modelConfig).not.toHaveProperty("baseUrl");
    }
  });
});
