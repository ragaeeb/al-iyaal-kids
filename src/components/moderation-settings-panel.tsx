import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModerationSettings } from "@/features/media/types";
import { isValidModerationSettings } from "@/features/moderation/validation";

type ModerationSettingsPanelProps = {
  onLoad: () => Promise<ModerationSettings>;
  onSave: (settings: ModerationSettings) => Promise<{ success: boolean }>;
};

const toLines = (values: string[]) => values.join("\n");
const fromLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const ModerationSettingsPanel = ({ onLoad, onSave }: ModerationSettingsPanelProps) => {
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [rulesJson, setRulesJson] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const loaded = await onLoad();
        if (!mounted) {
          return;
        }
        setSettings(loaded);
        setRulesJson(JSON.stringify(loaded.rules, null, 2));
      } catch (error: unknown) {
        if (mounted) {
          setErrorMessage(error instanceof Error ? error.message : "Failed loading settings.");
        }
      }
    };
    load().catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [onLoad]);

  if (!settings) {
    return (
      <Card>
        <CardTitle>Moderation Rules</CardTitle>
        <CardContent>
          <p className="text-[#6e3933] text-sm">Loading moderation settings...</p>
        </CardContent>
      </Card>
    );
  }

  const handleSave = async () => {
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const parsedRules = JSON.parse(rulesJson) as unknown;
      const candidate: ModerationSettings = {
        ...settings,
        profanityWords: fromLines(toLines(settings.profanityWords)),
        rules: Array.isArray(parsedRules) ? parsedRules : [],
      };
      if (!isValidModerationSettings(candidate)) {
        setErrorMessage("Moderation settings are invalid. Check rules JSON and fields.");
        return;
      }
      await onSave(candidate);
      setSettings(candidate);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Failed saving settings.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardTitle>Moderation Rules</CardTitle>
      <CardDescription>
        Local-first profanity and aqeedah filtering rules for flag batches.
      </CardDescription>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="criteria-input">Content Criteria</Label>
          <textarea
            id="criteria-input"
            value={settings.contentCriteria}
            onChange={(event) =>
              setSettings({
                ...settings,
                contentCriteria: event.currentTarget.value,
              })
            }
            className="h-28 w-full rounded-md border border-[#d1968f]/45 bg-white/70 p-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="guidelines-input">Priority Guidelines</Label>
          <textarea
            id="guidelines-input"
            value={settings.priorityGuidelines}
            onChange={(event) =>
              setSettings({
                ...settings,
                priorityGuidelines: event.currentTarget.value,
              })
            }
            className="h-24 w-full rounded-md border border-[#d1968f]/45 bg-white/70 p-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="profanity-input">Custom Profanity Words (one per line)</Label>
          <textarea
            id="profanity-input"
            value={toLines(settings.profanityWords)}
            onChange={(event) =>
              setSettings({
                ...settings,
                profanityWords: fromLines(event.currentTarget.value),
              })
            }
            className="h-20 w-full rounded-md border border-[#d1968f]/45 bg-white/70 p-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="rules-json-input">Rules JSON</Label>
          <textarea
            id="rules-json-input"
            value={rulesJson}
            onChange={(event) => setRulesJson(event.currentTarget.value)}
            className="h-32 w-full rounded-md border border-[#d1968f]/45 bg-white/70 p-2 font-mono text-xs"
          />
        </div>

        {errorMessage ? (
          <Input
            value={errorMessage}
            readOnly
            className="border-rose-200 bg-rose-50 text-rose-700 text-sm"
          />
        ) : null}

        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Moderation Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};

export { ModerationSettingsPanel };
