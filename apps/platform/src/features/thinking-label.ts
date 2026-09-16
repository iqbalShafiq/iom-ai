export function formatThinkingDuration(elapsedMs: number): string {
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  return `Berpikir selama ${seconds} detik`;
}

export function thinkingStatusLabel(options: {
  isLive: boolean;
  elapsedMs: number | null;
}): string {
  if (options.isLive && (options.elapsedMs === null || options.elapsedMs < 500)) {
    return "Berpikir…";
  }
  if (options.elapsedMs !== null) return formatThinkingDuration(options.elapsedMs);
  return "Berpikir sejenak";
}
