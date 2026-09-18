import type { RedactorPattern } from "@anvia/langfuse";

export const observabilityRedactionReplacement = "[REDACTED]";

export const observabilityRedactionPatterns: RedactorPattern[] = [
  {
    name: "authorization-header",
    regex: /(?:authorization|proxy-authorization)\s*[:=]\s*["']?[^"'\s]+/gi,
  },
  { name: "bearer-token", regex: /bearer\s+[a-z0-9._\-+=/]+/gi },
  { name: "api-key-header", regex: /(?:x-api-key|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+/gi },
  { name: "cookie-header", regex: /(?:cookie|set-cookie)\s*[:=]\s*[^;\r\n]+/gi },
  { name: "password-field", regex: /(?:password|passwordHash|passwd)\s*[:=]\s*["']?[^"'\s]+/gi },
  {
    name: "database-url",
    regex: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi,
  },
  { name: "qdrant-key", regex: /(?:QDRANT_API_KEY|qdrantApiKey)\s*[:=]\s*["']?[^"'\s]+/gi },
  { name: "storage-key", regex: /(?:storageKey|STORAGE_ROOT)\s*[:=]\s*["']?[^"'\s]+/gi },
  { name: "encrypted-reasoning", regex: /encrypted_content\s*[:=]\s*["']?[^"'\s]+/gi },
  { name: "openai-sk", regex: /\bsk-[A-Za-z0-9_-]{8,}\b/g },
  { name: "langfuse-pk", regex: /\bpk-lf-[A-Za-z0-9_-]+\b/g },
  { name: "langfuse-sk", regex: /\bsk-lf-[A-Za-z0-9_-]+\b/g },
];

const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|password|passwordhash|passwd|api[_-]?key|secret|token|database_url|qdrant_api_key|storagekey|encrypted_content)$/i;

export function maskSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") {
    return observabilityRedactionPatterns.reduce(
      (current, pattern) => current.replace(pattern.regex, observabilityRedactionReplacement),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => maskSensitiveValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? observabilityRedactionReplacement
          : maskSensitiveValue(nested),
      ]),
    );
  }
  return value;
}

export function truncatedPayloadMarker(bytes: number, maxBytes: number) {
  return { payloadTruncated: bytes > maxBytes, captureMaxBytes: maxBytes };
}
