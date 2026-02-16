import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dir, "..");

const packageJsonPath = path.join(rootDir, "package.json");
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");

const updateCargoVersion = (cargoToml: string, version: string) => {
  const lines = cargoToml.split("\n");
  const packageStart = lines.findIndex((line) => line.trim() === "[package]");

  if (packageStart === -1) {
    throw new Error("Unable to find [package] section in src-tauri/Cargo.toml");
  }

  const nextSectionOffset = lines
    .slice(packageStart + 1)
    .findIndex((line) => /^\s*\[.+\]\s*$/.test(line));
  const packageEnd = nextSectionOffset === -1 ? lines.length : packageStart + 1 + nextSectionOffset;

  const versionLineIndex = lines
    .slice(packageStart, packageEnd)
    .findIndex((line) => /^version\s*=\s*".*"$/.test(line.trim()));

  if (versionLineIndex === -1) {
    throw new Error("Unable to find package version field in src-tauri/Cargo.toml");
  }

  const absoluteVersionLineIndex = packageStart + versionLineIndex;
  lines[absoluteVersionLineIndex] = `version = "${version}"`;
  return `${lines.join("\n")}\n`;
};

const updateJsonVersionLine = (content: string, version: string, label: string) => {
  const lines = content.split("\n");
  const versionIndex = lines.findIndex((line) => /^\s*"version"\s*:\s*".*"\s*,?\s*$/.test(line));
  if (versionIndex === -1) {
    throw new Error(`Unable to find version field in ${label}`);
  }
  const hasComma = lines[versionIndex]?.trim().endsWith(",");
  lines[versionIndex] = `  "version": "${version}"${hasComma ? "," : ""}`;
  return `${lines.join("\n")}\n`;
};

const syncVersion = async () => {
  const packageJsonContent = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonContent) as { version: string };
  const nextVersion = packageJson.version;

  if (!nextVersion) {
    throw new Error("Missing version field in package.json");
  }

  const tauriConfigContent = await readFile(tauriConfigPath, "utf8");
  const updatedTauriConfig = updateJsonVersionLine(
    tauriConfigContent,
    nextVersion,
    "src-tauri/tauri.conf.json",
  );
  await writeFile(tauriConfigPath, updatedTauriConfig, "utf8");

  const cargoTomlContent = await readFile(cargoTomlPath, "utf8");
  const updatedCargoToml = updateCargoVersion(cargoTomlContent, nextVersion);
  await writeFile(cargoTomlPath, updatedCargoToml, "utf8");

  console.log(`Synced Tauri/Cargo versions to ${nextVersion}`);
};

await syncVersion();
