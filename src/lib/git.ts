import { execSync } from "child_process";

export function getGitInfo() {
  try {
    const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || execSync("git rev-parse --short HEAD", { timeout: 1000 }).toString().trim();
    const branch = process.env.VERCEL_GIT_COMMIT_REF || execSync("git branch --show-current", { timeout: 1000 }).toString().trim() || "development";
    return { commitSha, branch };
  } catch {
    return { commitSha: "5890177", branch: "development" };
  }
}
