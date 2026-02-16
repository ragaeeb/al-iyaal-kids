import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dir, "..");
const logoPath = path.join(rootDir, "logo.png");
const iconsDir = path.join(rootDir, "src-tauri", "icons");

const requiredIconFiles = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.icns"] as const;
const keepEntries = new Set([...requiredIconFiles, ".gitkeep"]);

const run = () => {
  if (!existsSync(logoPath)) {
    throw new Error(`Missing logo source at ${logoPath}`);
  }

  mkdirSync(iconsDir, { recursive: true });

  const command = Bun.spawnSync(["bunx", "tauri", "icon", logoPath, "--output", iconsDir], {
    cwd: rootDir,
    stderr: "inherit",
    stdout: "inherit",
  });

  if (command.exitCode !== 0) {
    throw new Error(`tauri icon generation failed with exit code ${command.exitCode}`);
  }

  for (const entry of readdirSync(iconsDir)) {
    if (keepEntries.has(entry)) {
      continue;
    }
    rmSync(path.join(iconsDir, entry), { force: true, recursive: true });
  }

  for (const requiredFile of requiredIconFiles) {
    const requiredPath = path.join(iconsDir, requiredFile);
    if (!existsSync(requiredPath)) {
      throw new Error(`Expected generated icon file missing: ${requiredPath}`);
    }
  }

  console.log("Icon sync complete (macOS bundle icons only).");
};

run();
