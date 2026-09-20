import { JobProcessingError } from "./runner.js";

export async function runWithAiTimeout<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([parentSignal, timeoutSignal]);
  try {
    return await operation(signal);
  } catch (error) {
    if (timeoutSignal.aborted && !parentSignal.aborted) {
      throw new JobProcessingError("AI_OPERATION_TIMEOUT", true);
    }
    throw error;
  }
}
