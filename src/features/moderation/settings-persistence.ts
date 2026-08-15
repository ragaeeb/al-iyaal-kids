import type { ModerationSettings } from "@/features/media/types";

type SaveModerationSettings = (settings: ModerationSettings) => Promise<unknown>;

export const createModerationSettingsSaveQueue = (save: SaveModerationSettings) => {
  let pending = Promise.resolve<unknown>(undefined);

  return (settings: ModerationSettings) => {
    pending = pending.catch(() => undefined).then(() => save(settings));
    return pending;
  };
};
