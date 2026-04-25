import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getModerationSettings, saveModerationSettings } from "@/features/media/transport";
import type { ModerationSettings } from "@/features/media/types";

const defaultSettings: ModerationSettings = {
  amazonNovaApiKey: "",
  analysisStrategy: "fast",
  contentCriteria:
    "1. Adult relationships (kissing, romantic/sexual content, dating)\n2. Bad morals or unethical behavior\n3. Content against Islamic values and aqeedah\n4. Magic, sorcery, or supernatural practices\n5. Music references or musical performances\n6. Violence or frightening content\n7. Inappropriate language or themes",
  engine: "blacklist",
  googleApiKey: "",
  priorityGuidelines:
    "Priority Guidelines:\n- HIGH: Major aqeedah violations, explicit magic/sorcery, sexual content\n- MEDIUM: Offensive language, questionable behavior, moderate violence\n- LOW: Mild concerns, ambiguous references",
  profanityWords: [],
  rules: [
    {
      category: "aqeedah",
      patterns: ["christmas", "xmas", "easter"],
      priority: "high",
      reason: "Promotes non-Islamic religious celebration.",
      ruleId: "aqeedah_christmas",
    },
    {
      category: "magic",
      patterns: ["spell", "sorcery", "witchcraft"],
      priority: "high",
      reason: "References magic or sorcery.",
      ruleId: "magic_sorcery",
    },
    {
      category: "language",
      patterns: ["stupid", "idiot", "dumb"],
      priority: "medium",
      reason: "Contains offensive language.",
      ruleId: "offensive_language",
    },
  ],
};

const SettingsPanel = () => {
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      setErrorMessage(null);
      try {
        const loaded = await getModerationSettings();
        if (!mounted) {
          return;
        }
        setSettings(loaded);
      } catch (error: unknown) {
        if (!mounted) {
          return;
        }
        setSettings(defaultSettings);
        setErrorMessage(error instanceof Error ? error.message : "Failed loading settings.");
      }
    };

    loadSettings().catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

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
    <div className="grid gap-2 lg:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader className="grid grid-cols-[1fr_auto] gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <span className="flex size-7 items-center justify-center rounded-lg bg-[#f5e6dc] text-[#88322d]">
                <KeyRound className="size-3.5" />
              </span>
              API Keys
            </CardTitle>
            <p className="mt-0.5 text-[#8f5e56] text-xs">
              API keys for cloud analysis. Saved locally.
            </p>
          </div>
          <Button type="button" size="sm" onClick={saveSettings} disabled={!settings || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2">
          <label htmlFor="google-gemini-api-key" className="space-y-1">
            <span className="text-[#8f5e56] text-xs">Google Gemini API Key</span>
            <Input
              id="google-gemini-api-key"
              type="password"
              value={settings?.googleApiKey ?? ""}
              onChange={(event) => updateGeminiKey(event.currentTarget.value)}
              placeholder="AIza..."
            />
          </label>
          <label htmlFor="amazon-nova-api-key" className="space-y-1">
            <span className="text-[#8f5e56] text-xs">Amazon Nova API Key</span>
            <Input
              id="amazon-nova-api-key"
              type="password"
              value={settings?.amazonNovaApiKey ?? ""}
              onChange={(event) => updateNovaKey(event.currentTarget.value)}
              placeholder="nova_..."
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider Notes</CardTitle>
          <p className="mt-0.5 text-[#8f5e56] text-xs">
            Engine settings are used when analysis runs from Edit Video.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {errorMessage ? (
            <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 text-xs">
              {errorMessage}
            </p>
          ) : null}
          <div className="rounded-[12px] border border-[#ead3c4] bg-[#fffaf6] px-2.5 py-2 text-[#7f524a] text-xs">
            Use Settings for API keys and moderation provider defaults.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export { SettingsPanel };
