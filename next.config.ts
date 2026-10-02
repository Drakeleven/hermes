import type { NextConfig } from "next";
import { execSync } from "child_process";

const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || execSync("git rev-parse --short HEAD").toString().trim();
const branch = process.env.VERCEL_GIT_COMMIT_REF || execSync("git branch --show-current").toString().trim() || "development";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
    NEXT_PUBLIC_BRANCH: branch,
  },
};

export default nextConfig;
