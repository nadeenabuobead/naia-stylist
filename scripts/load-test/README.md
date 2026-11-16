# Synthetic load-test harness — usage

Strategy, staging, and acceptance criteria live in [`docs/ops/load-test-plan.md`](../../docs/ops/load-test-plan.md). This file is just "how do I run it."

## Prove the harness works (no app, no DB, no provider — safe right now)

```
node scripts/load-test/run-load-test.mjs --self-test
```

Spins up `mock-providers-server.mjs` on a random local port and runs the staged 10/25/50/100-VU ramp against it directly. Makes zero requests to the real app, a real database, or a real provider. Use this to sanity-check the harness itself after any edit to it.

## Run against a local dev server

1. Start the mock-provider server in one terminal:
   ```
   node scripts/load-test/mock-providers-server.mjs
   ```
2. Start the app itself in another terminal with the mocks wired in:
   ```
   ALLOW_PROVIDER_MOCKS=true \
   FASHN_MOCK_BASE_URL=http://127.0.0.1:8899/fashn \
   CLAUDE_MOCK_BASE_URL=http://127.0.0.1:8899/claude \
   npm run dev
   ```
3. Build a fixtures file — see [`fixtures/README.md`](fixtures/README.md) first; none is provided.
4. Run the harness:
   ```
   TARGET_BASE_URL=http://127.0.0.1:3000 \
   ALLOW_PROVIDER_MOCKS=true \
   FIXTURES_FILE=scripts/load-test/fixtures/local-dev-sessions.json \
   STAGES=10,25,50,100 \
   STAGE_DURATION_SECONDS=60 \
   node scripts/load-test/run-load-test.mjs
   ```

## Running against anything other than localhost

The harness hard-refuses by default (see `guardHost()` in `run-load-test.mjs`) — it exits 1 unless the target hostname is `localhost`/`127.0.0.1`/`::1`, or `ALLOW_REMOTE_LOAD_TEST_HOST` is set to the exact target hostname. **Do not set that variable to point at `naia-stylist-staging.vercel.app` or `naia-stylist.vercel.app` — those are shared/production environments.** If a disposable isolated Preview deployment is ever explicitly approved as a load-test target, set `ALLOW_REMOTE_LOAD_TEST_HOST` to that deployment's own hostname only, for that one run.
