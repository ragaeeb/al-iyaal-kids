import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ModerationSettings } from "@/features/media/types";
import { isValidModerationSettings } from "@/features/moderation/validation";

type ModerationSettingsPanelProps = {
  onLoad: () => Promise<ModerationSettings>;
  onSave: (settings: ModerationSettings) => Promise<{ success: boolean }>;
};

const textareaClassName =
  "min-h-24 w-full rounded-[18px] border border-[#d9b7a5] bg-white px-4 py-3 text-sm text-[#4f1f1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-[#88322d] focus:ring-[3px] focus:ring-[#c57267]/25";

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
        <CardHeader>
          <CardTitle>Moderation Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[#8f5e56] text-sm">Loading moderation settings...</p>
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
        setErrorMessage("Moderation settings are invalid. Check the JSON shape and text fields.");
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
      <CardHeader>
        <CardTitle>Moderation Rules</CardTitle>
        <CardDescription>
          Edit the local-first profanity and aqeedah filtering rules used during flag batches.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
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
            className={`${textareaClassName} min-h-32`}
          />
        </div>

        <div className="space-y-2">
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
            className={`${textareaClassName} min-h-28`}
          />
        </div>

        <div className="space-y-2">
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
            className={`${textareaClassName} min-h-24`}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rules-json-input">Rules JSON</Label>
          <textarea
            id="rules-json-input"
            value={rulesJson}
            onChange={(event) => setRulesJson(event.currentTarget.value)}
            className={`${textareaClassName} min-h-64 font-mono text-xs`}
          />
        </div>

        {errorMessage ? (
          <p className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 text-sm">
            {errorMessage}
          </p>
        ) : null}

        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Moderation Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};

export { ModerationSettingsPanel };
