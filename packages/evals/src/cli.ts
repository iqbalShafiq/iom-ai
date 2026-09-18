import { resetDevCorpus } from "./reset-dev-corpus.js";
import { type EvalSuiteName, runIomEvalSuite, runObservabilityProbe } from "./runner.js";

const command = process.argv[2] ?? "smoke";
if (command === "reset-corpus") {
  await resetDevCorpus();
  process.exit(0);
}
if (command === "observability") {
  await runObservabilityProbe();
  process.exit(process.exitCode ?? 0);
}

const suite = command as EvalSuiteName;
const allowed: EvalSuiteName[] = ["confidentiality", "overlap", "chat", "all", "smoke"];
if (!allowed.includes(suite)) {
  console.error(
    `Unknown eval suite: ${suite}. Use ${allowed.join(", ")}, observability, or reset-corpus.`,
  );
  process.exit(1);
}

await runIomEvalSuite(suite);
