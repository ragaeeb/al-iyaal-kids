import { describe, expect, it } from "bun:test";

const readStartupFiles = async () => {
  const [indexHtml, styles, tauriConfig] = await Promise.all([
    Bun.file("index.html").text(),
    Bun.file("src/styles.css").text(),
    Bun.file("src-tauri/tauri.conf.json").text(),
  ]);

  return { indexHtml, styles, tauriConfig };
};

describe("startup shell", () => {
  it("should render a local branded frame without external font requests", async () => {
    const { indexHtml, styles, tauriConfig } = await readStartupFiles();

    expect(indexHtml).toContain('class="boot-shell"');
    expect(indexHtml).toContain("Preparing your local media studio...");
    expect(`${indexHtml}\n${styles}`).not.toContain("fonts.googleapis.com");
    expect(tauriConfig).toContain('"backgroundColor": "#f8efe8"');
  });

  it("should use standard light native window chrome", async () => {
    const { tauriConfig } = await readStartupFiles();
    const config = JSON.parse(tauriConfig);
    const mainWindow = config.app.windows.find(
      (window: { label?: string }) => window.label === "main",
    );

    expect(mainWindow.decorations).toBe(true);
    expect(mainWindow.theme).toBe("Light");
    expect(mainWindow.titleBarStyle).toBe("Visible");
  });
});
