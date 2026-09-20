import { resetDevCorpus } from "./reset-dev-corpus.js";
import { type EvalSuiteName, runIomEvalSuite, runObservabilityProbe } from "./runner.js";

const command = process.argv[2] ?? "smoke";
if (command === "reset-corpus") {
  await resetDevCorpus();
} else if (command === "observability") {
  await runObservabilityProbe();
} else {
  const suite = command as EvalSuiteName;
  const allowed: EvalSuiteName[] = ["confidentiality", "overlap", "chat", "all", "smoke"];
  if (!allowed.includes(suite)) {
    throw new Error(
      `Unknown eval suite: ${suite}. Use ${allowed.join(", ")}, observability, or reset-corpus.`,
    );
  }
  await runIomEvalSuite(suite);
}
