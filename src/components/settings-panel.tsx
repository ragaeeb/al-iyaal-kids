import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getModerationSettings, saveModerationSettings } from "@/features/media/transport";
import type { ModerationSettings } from "@/features/media/types";

const SettingsPanel = () => {
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    setErrorMessage(null);
    try {
      const loaded = await getModerationSettings();
      setSettings(loaded);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed loading settings.");
    }
  }, []);

  useEffect(() => {
    loadSettings().catch(() => undefined);
  }, [loadSettings]);

  const saveSettings = async () => {
    if (!settings) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await saveModerationSettings(settings);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed saving settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const updateGeminiKey = (value: string) => {
    setSettings((previous) =>
      previous
        ? {
            ...previous,
            googleApiKey: value,
          }
        : previous,
    );
  };

  const updateNovaKey = (value: string) => {
    setSettings((previous) =>
      previous
        ? {
            ...previous,
            amazonNovaApiKey: value,
          }
        : previous,
    );
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader className="grid grid-cols-[1fr_auto] gap-4">
          <div>
            <CardTitle className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-[#f5e6dc] text-[#88322d]">
                <KeyRound className="size-4" />
              </span>
              API Keys
            </CardTitle>
            <p className="mt-1 text-[#8f5e56] text-sm">
              Save provider keys for cloud subtitle analysis. Keys are stored locally in app data.
            </p>
          </div>
          <Button type="button" size="sm" onClick={saveSettings} disabled={!settings || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="space-y-2">
            <span className="text-[#8f5e56] text-sm">Google Gemini API Key</span>
            <input
              type="password"
              value={settings?.googleApiKey ?? ""}
              onChange={(event) => updateGeminiKey(event.currentTarget.value)}
              className="h-10 w-full rounded-[18px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-sm outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[3px]"
              placeholder="AIza..."
            />
          </label>
          <label className="space-y-2">
            <span className="text-[#8f5e56] text-sm">Amazon Nova API Key</span>
            <input
              type="password"
              value={settings?.amazonNovaApiKey ?? ""}
              onChange={(event) => updateNovaKey(event.currentTarget.value)}
              className="h-10 w-full rounded-[18px] border border-[#d9b7a5] bg-white px-3 text-[#4f1f1a] text-sm outline-none transition focus:border-[#88322d] focus:ring-[#c57267]/25 focus:ring-[3px]"
              placeholder="nova_..."
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider Notes</CardTitle>
          <p className="mt-1 text-[#8f5e56] text-sm">
            Engine and reasoning depth are chosen per run in the Profanity Detection screen.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage ? (
            <p className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 text-sm">
              {errorMessage}
            </p>
          ) : null}
          <div className="rounded-[18px] border border-[#ead3c4] bg-[#fffaf6] px-4 py-3 text-[#7f524a] text-sm">
            Use Settings only for API keys. Choose `Blacklist`, `Gemini`, or `Nova Pro`, and `Fast`
            or `Deep`, directly in the Profanity Detection tab for each run.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export { SettingsPanel };
