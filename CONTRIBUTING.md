# Contributing

## Standards

- Use ESNext TypeScript and strict mode.
- Prefer `type` aliases over `interface`.
- Prefer arrow functions over classical `function` definitions.
- Keep functions focused; extract reusable utility helpers instead of growing large procedural blocks.
- Write tests first where practical for pure logic and state transitions.
- Use `bun:test` with `it('should ...')` naming.
- DOM/component rendering tests are intentionally out of MVP scope.

## Commands

```bash
./scripts/bootstrap.sh
bun run dev
bun run check
cargo test --manifest-path src-tauri/Cargo.toml
uv run --project python-worker pytest
```

## Dependency updates

- Install latest versions intentionally.
- Upgrade manually on schedule (no automation bot).
- Regenerate Python lock intent file as needed:

```bash
uv pip compile python-worker/pyproject.toml -o python-worker/requirements.lock.txt
```
