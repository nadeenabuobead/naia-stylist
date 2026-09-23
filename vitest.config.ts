import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: false,
    // Agent worktrees under .claude/worktrees are full checkouts of this repo.
    // Without this, vitest discovers their copies of every test file and runs
    // them against the main working tree, so a stale branch's tests fail here.
    // Deliberately narrow: only the worktree path, not .claude as a whole.
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
  },
});
