import { useEffect, useRef, useState } from "react";

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
  "min-h-24 w-full rounded-[14px] border border-[#d9b7a5] bg-white px-3 py-2 text-xs text-[#4f1f1a] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-[#88322d] focus:ring-[2px] focus:ring-[#c57267]/25";

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
  const onLoadRef = useRef(onLoad);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const loaded = await onLoadRef.current();
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
  }, []);

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
      if (!Array.isArray(parsedRules)) {
        setErrorMessage("Rules JSON must be an array.");
        return;
      }

      const candidate: ModerationSettings = {
        ...settings,
        profanityWords: fromLines(toLines(settings.profanityWords)),
        rules: parsedRules,
      };
      if (!isValidModerationSettings(candidate)) {
        setErrorMessage("Moderation settings are invalid. Check the JSON shape and text fields.");
        return;
      }

      const result = await onSave(candidate);
      if (!result.success) {
        setErrorMessage("Failed saving settings.");
        return;
      }

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
        <CardDescription>Edit profanity and aqeedah filtering rules.</CardDescription>
      </CardHeader>
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
            className={`${textareaClassName} min-h-32`}
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
            className={`${textareaClassName} min-h-28`}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="profanity-input">Custom Profanity Words</Label>
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

        <div className="space-y-1">
          <Label htmlFor="rules-json-input">Rules JSON</Label>
          <textarea
            id="rules-json-input"
            value={rulesJson}
            onChange={(event) => setRulesJson(event.currentTarget.value)}
            className={`${textareaClassName} min-h-64 font-mono text-[10px]`}
          />
        </div>

        {errorMessage ? (
          <p className="rounded-[12px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-rose-700 text-xs">
            {errorMessage}
          </p>
        ) : null}

        <Button type="button" size="sm" onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </CardContent>
    </Card>
  );
};

export { ModerationSettingsPanel };
