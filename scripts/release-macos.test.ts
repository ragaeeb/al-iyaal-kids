import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const temporaryRoots: string[] = [];

const writeExecutable = async (filePath: string, content: string) => {
  await Bun.write(filePath, content);
  await chmod(filePath, 0o755);
};

const createReleaseToolFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "al-iyaal-release-"));
  const binDir = path.join(root, "bin");
  temporaryRoots.push(root);
  await mkdir(binDir, { recursive: true });

  await Promise.all([
    writeExecutable(path.join(binDir, "uname"), "#!/usr/bin/env bash\necho Darwin\n"),
    writeExecutable(
      path.join(binDir, "security"),
      [
        "#!/usr/bin/env bash",
        "echo '  1) ABCDEF \"Developer ID Application: Test Release (TEAM123456)\"'",
        "",
      ].join("\n"),
    ),
    writeExecutable(
      path.join(binDir, "xcrun"),
      [
        "#!/usr/bin/env bash",
        'expected="notarytool history --keychain-profile al-iyaal-kids-notary --team-id TEAM123456 --output-format json"',
        'if [[ "$*" != "$expected" ]]; then',
        '  echo "Unexpected xcrun invocation: $*" >&2',
        "  exit 7",
        "fi",
        "echo '{\"history\":[]}'",
        "",
      ].join("\n"),
    ),
    writeExecutable(
      path.join(binDir, "bun"),
      '#!/usr/bin/env bash\necho "Preflight must not run build checks." >&2\nexit 91\n',
    ),
  ]);

  return binDir;
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("macOS release workflow", () => {
  it("should present the single public release command", async () => {
    const child = Bun.spawn(["bash", "./scripts/release-macos.sh", "--help"], {
      cwd: process.cwd(),
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    await child.exited;

    expect(child.exitCode).toBe(0);
    expect(stdout).toContain("bun run release:macos");
  });

  it("should auto-discover Keychain release credentials during preflight without building", async () => {
    const binDir = await createReleaseToolFixture();
    const child = Bun.spawn(["bash", "./scripts/release-macos.sh", "--preflight"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AIYAAL_NOTARY_PROFILE: "",
        APPLE_NOTARY_PROFILE: "",
        APPLE_SIGNING_IDENTITY: "",
        APPLE_TEAM_ID: "",
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(child.exitCode).toBe(0, stderr);
    expect(stdout).toContain("Developer ID Application: Test Release (TEAM123456)");
    expect(stdout).toContain("Derived Team ID: TEAM123456");
    expect(stdout).toContain("Notary profile: al-iyaal-kids-notary");
    expect(stdout).toContain("Release preflight completed successfully");
    expect(stdout).not.toContain("Notary keychain profile [");
  });
});
