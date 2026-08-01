import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = process.cwd();

const run = async (command: string[], cwd: string) => {
  const process = Bun.spawn(command, { cwd, stderr: "pipe", stdout: "pipe" });
  await process.exited;
  const stderr = await new Response(process.stderr).text();
  expect(process.exitCode).toBe(0, stderr);
};

const createPreflightFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "al-iyaal-preflight-"));
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "src-tauri"), { recursive: true });

  await Promise.all([
    Bun.write(
      path.join(root, "scripts", "sync-version.ts"),
      Bun.file(path.join(workspaceRoot, "scripts", "sync-version.ts")),
    ),
    Bun.write(
      path.join(root, "scripts", "sync-yap.sh"),
      Bun.file(path.join(workspaceRoot, "scripts", "sync-yap.sh")),
    ),
    Bun.write(path.join(root, "package.json"), '{\n  "version": "1.3.0"\n}\n'),
    Bun.write(path.join(root, "src-tauri", "tauri.conf.json"), '{\n  "version": "1.3.0"\n}\n'),
    Bun.write(path.join(root, "src-tauri", "Cargo.toml"), '[package]\nversion = "1.3.0"\n'),
  ]);

  return root;
};

describe("development preflight scripts", () => {
  it("should not rewrite synced version files when their versions already match", async () => {
    const root = await createPreflightFixture();
    const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
    const cargoTomlPath = path.join(root, "src-tauri", "Cargo.toml");

    try {
      await run(["bun", "./scripts/sync-version.ts"], root);
      const before = await Promise.all([stat(tauriConfigPath), stat(cargoTomlPath)]);
      await Bun.sleep(20);
      await run(["bun", "./scripts/sync-version.ts"], root);
      const after = await Promise.all([stat(tauriConfigPath), stat(cargoTomlPath)]);

      expect(after.map((file) => file.mtimeMs)).toEqual(before.map((file) => file.mtimeMs));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("should not rewrite the YAP wrapper when it is current", async () => {
    const root = await createPreflightFixture();
    const wrapperPath = path.join(root, "assets", "bin", "yap.sh");

    try {
      await run(["bash", "./scripts/sync-yap.sh"], root);
      const before = await stat(wrapperPath);
      await Bun.sleep(20);
      await run(["bash", "./scripts/sync-yap.sh"], root);
      const after = await stat(wrapperPath);

      expect(after.mtimeMs).toBe(before.mtimeMs);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
