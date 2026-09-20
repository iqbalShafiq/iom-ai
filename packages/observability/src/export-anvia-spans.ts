import { LangfuseSpanProcessor } from "@langfuse/otel";

type LangfuseSpanProcessorInstance = {
  shouldExportSpan: (args: { otelSpan: unknown }) => boolean;
  processEndedSpan: (span: unknown) => Promise<void>;
};

let patched = false;

/**
 * @langfuse/otel 5 default-filters spans unless they come from the Langfuse SDK
 * tracer or carry gen_ai.* attributes. Anvia traces with `@anvia/langfuse`, so
 * those spans would never reach Langfuse Cloud without this override.
 */
export function allowAnviaLangfuseSpanExport() {
  if (patched) return;
  patched = true;
  const proto = LangfuseSpanProcessor.prototype as unknown as LangfuseSpanProcessorInstance;
  const original = proto.processEndedSpan;
  proto.processEndedSpan = async function (this: LangfuseSpanProcessorInstance, span: unknown) {
    this.shouldExportSpan = () => true;
    return original.call(this, span);
  };
}
