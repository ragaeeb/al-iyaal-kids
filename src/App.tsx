import { useEffect, useMemo, useRef, useState } from "react";

import { AnalyticsPanel } from "@/components/analytics-panel";
import { DashboardPanel } from "@/components/dashboard-panel";
import { AppShell } from "@/components/layout/app-shell";
import { RemoveMusicPanel } from "@/components/remove-music-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { SimpleCutEditorPanel } from "@/components/simple-cut-editor-panel";
import { type AppPage, defaultAppPage } from "@/features/app/navigation";
import { trashFile } from "@/features/batch/transport";
import { useBatchController } from "@/features/batch/useBatchController";
import {
  canStartQueuedMediaAction,
  enqueueMediaQuickAction,
  hasActiveMediaTask,
  type MediaQuickAction,
  removeMediaQuickAction,
} from "@/features/media/quick-action-queue";
import {
  buildLatestTaskJobByInput,
  buildLatestTaskOutputPathByInput,
} from "@/features/media/selectors";
import { useMediaController } from "@/features/media/useMediaController";

const isActiveBatchStatus = (status: string) => status === "queued" || status === "running";

const App = () => {
  const [activePage, setActivePage] = useState<AppPage>(defaultAppPage);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [removeMusicQuickActionQueue, setRemoveMusicQuickActionQueue] = useState<
    MediaQuickAction[]
  >([]);
  const [launchingQuickActionId, setLaunchingQuickActionId] = useState<string | null>(null);
  const isLaunchingQuickActionRef = useRef(false);
  const launchQuickActionRef = useRef<(action: MediaQuickAction) => Promise<void>>(async () => {});
  const batchController = useBatchController();
  const mediaController = useMediaController();
  const transcriptionOutputByInputPath = useMemo(
    () => buildLatestTaskOutputPathByInput(mediaController.state.tasksById, "transcription"),
    [mediaController.state.tasksById],
  );
  const analysisOutputByInputPath = useMemo(
    () => buildLatestTaskOutputPathByInput(mediaController.state.tasksById, "flag"),
    [mediaController.state.tasksById],
  );
  const transcriptionJobByInputPath = useMemo(
    () => buildLatestTaskJobByInput(mediaController.state.tasksById, "transcription"),
    [mediaController.state.tasksById],
  );
  const analysisJobByInputPath = useMemo(
    () => buildLatestTaskJobByInput(mediaController.state.tasksById, "flag"),
    [mediaController.state.tasksById],
  );
  const queuedTranscriptionPaths = useMemo(
    () =>
      removeMusicQuickActionQueue
        .filter((action) => action.kind === "transcription")
        .map((action) => action.inputPath),
    [removeMusicQuickActionQueue],
  );
  const queuedAnalysisPaths = useMemo(
    () =>
      removeMusicQuickActionQueue
        .filter((action) => action.kind === "flag")
        .map((action) => action.inputPath),
    [removeMusicQuickActionQueue],
  );
  const hasActiveBatch = batchController.activeBatch
    ? isActiveBatchStatus(batchController.activeBatch.status)
    : false;
  const hasActiveTask = useMemo(
    () => hasActiveMediaTask(mediaController.state.tasksById),
    [mediaController.state.tasksById],
  );
  const videoPathBySubtitlePath = useMemo(
    () =>
      Object.entries(transcriptionOutputByInputPath).reduce<Record<string, string>>(
        (index, [videoPath, subtitlePath]) => {
          index[subtitlePath] = videoPath;
          return index;
        },
        {},
      ),
    [transcriptionOutputByInputPath],
  );

  useEffect(() => {
    launchQuickActionRef.current = async (action) => {
      if (action.kind === "transcription") {
        await mediaController.startTranscriptionForPaths([action.inputPath]);
        return;
      }

      await mediaController.startFlaggingForPaths([action.inputPath]);
    };
  });

  useEffect(() => {
    if (
      !canStartQueuedMediaAction({
        hasActiveBatch,
        hasActiveTask,
        isLaunching: isLaunchingQuickActionRef.current,
        queueLength: removeMusicQuickActionQueue.length,
        workerStatus: mediaController.state.workerStatus,
      })
    ) {
      return;
    }

    const nextAction = removeMusicQuickActionQueue[0];
    if (!nextAction) {
      return;
    }

    isLaunchingQuickActionRef.current = true;
    setLaunchingQuickActionId(nextAction.id);
    launchQuickActionRef.current(nextAction).finally(() => {
      isLaunchingQuickActionRef.current = false;
      setRemoveMusicQuickActionQueue((queue) => removeMediaQuickAction(queue, nextAction.id));
      setLaunchingQuickActionId(null);
    });
  }, [
    hasActiveBatch,
    hasActiveTask,
    mediaController.state.workerStatus,
    removeMusicQuickActionQueue,
  ]);

  return (
    <AppShell
      activePage={activePage}
      isSidebarCollapsed={isSidebarCollapsed}
      onNavigate={setActivePage}
      onToggleSidebar={() => setIsSidebarCollapsed((previous) => !previous)}
    >
      <section hidden={activePage !== "dashboard"} aria-hidden={activePage !== "dashboard"}>
        <DashboardPanel onNavigate={setActivePage} />
      </section>
      <section hidden={activePage !== "remove-music"} aria-hidden={activePage !== "remove-music"}>
        <RemoveMusicPanel
          isActive={activePage === "remove-music"}
          selectedInputPaths={batchController.state.selectedInputPaths}
          isStartingBatch={batchController.state.isStartingBatch}
          workerStatus={batchController.state.workerStatus}
          workerMessage={batchController.state.workerMessage}
          progressPct={batchController.progressPct}
          errorMessage={batchController.state.errorMessage}
          jobs={batchController.jobs}
          onAddInputFiles={batchController.addInputFiles}
          onAddInputFolder={batchController.addInputFolder}
          onAddResolvedInputPaths={batchController.addResolvedInputPaths}
          onClearSelectedInputs={() => batchController.setSelectedInputPaths([])}
          onStart={batchController.start}
          onCancel={batchController.cancel}
          onOpenOutput={batchController.openOutput}
          onSendToTranscription={async (path) => {
            setRemoveMusicQuickActionQueue((queue) =>
              enqueueMediaQuickAction(queue, "transcription", path),
            );
          }}
          onSendToProfanity={async (path) => {
            setRemoveMusicQuickActionQueue((queue) => enqueueMediaQuickAction(queue, "flag", path));
            mediaController.selectVideo(videoPathBySubtitlePath[path] ?? null);
          }}
          onSendToCut={(path) => {
            mediaController.selectVideo(path);
            setActivePage("cut-video");
          }}
          onTrashOriginal={async (path) => {
            await trashFile(path);
          }}
          transcriptionOutputByInputPath={transcriptionOutputByInputPath}
          analysisOutputByInputPath={analysisOutputByInputPath}
          transcriptionJobByInputPath={transcriptionJobByInputPath}
          analysisJobByInputPath={analysisJobByInputPath}
          queuedTranscriptionPaths={queuedTranscriptionPaths}
          queuedAnalysisPaths={queuedAnalysisPaths}
          launchingQuickActionId={launchingQuickActionId}
          onClearError={batchController.clearError}
        />
      </section>
      <section hidden={activePage !== "cut-video"} aria-hidden={activePage !== "cut-video"}>
        <SimpleCutEditorPanel controller={mediaController} isActive={activePage === "cut-video"} />
      </section>
      <section hidden={activePage !== "analytics"} aria-hidden={activePage !== "analytics"}>
        <AnalyticsPanel />
      </section>
      <section hidden={activePage !== "settings"} aria-hidden={activePage !== "settings"}>
        <SettingsPanel />
      </section>
    </AppShell>
  );
};

export default App;
