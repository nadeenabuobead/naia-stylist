// Side-effect-only test setup. Import this BEFORE any static import of
// `session.server` in a test file — ESM evaluates static imports in the
// order they appear, fully resolving each one (and its own top-level code)
// before moving to the next, so this module's assignment below is guaranteed
// to run before `session.server`'s top-level secret check does.
//
// A plain `process.env.SESSION_SECRET = ...` statement written directly in
// the test file, even textually before its `import … from "session.server"`
// line, does NOT achieve this: static imports are hoisted ahead of a
// module's own top-level statements regardless of source position, so
// `session.server` would already have evaluated (and, after the 2026-11-12
// fail-closed hotfix, already thrown) before that statement ever ran.
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-session-secret-for-unit-tests";
}
