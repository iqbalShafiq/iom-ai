import { execFileSync } from "node:child_process";

const branch =
  process.env.GITHUB_HEAD_REF ??
  process.env.CI_COMMIT_REF_NAME ??
  execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
const protectedBranches = new Set(["main"]);
const valid = /^(feat|fix|refactor|perf|test|docs|chore|build|ci)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

if (!protectedBranches.has(branch) && !valid.test(branch)) {
  console.error(`Invalid branch name: ${branch}`);
  console.error("Use type/lowercase-kebab-case, for example feat/iom-batch-upload.");
  process.exit(1);
}
