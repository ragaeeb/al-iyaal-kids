# Contributing

## Standards

- Use ESNext TypeScript and strict mode.
- Prefer `type` aliases over `interface`.
- Prefer arrow functions over classical `function` definitions.
- Keep functions focused; extract reusable utility helpers instead of growing large procedural blocks.
- Write tests first where practical for pure logic and state transitions.
- Use `bun:test` with `it('should ...')` naming.
- DOM/component rendering tests are intentionally out of MVP scope.
- Keep docs aligned to the current shell: `Dashboard`, `Remove Music`, `Edit Video`, `Analytics`, `Settings`. Do not document separate transcription or profanity pages unless they are mounted in `App.tsx`.

## Commands

```bash
./scripts/bootstrap.sh
bun run dev
./scripts/check.sh
bun run check
bun run web:dev
cargo test --manifest-path src-tauri/Cargo.toml
PYTHONPATH=python-worker/src uv run --project python-worker --extra dev python -m pytest python-worker/tests
```

If you are running the Python worker directly or working on frame-scan code, sync the runtime extras too:

```bash
uv sync --project python-worker --extra dev --extra runtime
PYTHONPATH=python-worker/src uv run --project python-worker --extra runtime python python-worker/worker.py
```

## Dependency updates

- Install latest versions intentionally.
- Upgrade manually on schedule (no automation bot).
- Regenerate Python lock intent file as needed:

```bash
uv pip compile python-worker/pyproject.toml -o python-worker/requirements.lock.txt
```
