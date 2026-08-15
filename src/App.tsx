import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { DashboardPanel } from "@/components/dashboard-panel";
import { AppShell } from "@/components/layout/app-shell";
import { type AppPage, addVisitedPage, defaultAppPage } from "@/features/app/navigation";
import { useBatchController } from "@/features/batch/useBatchController";
import { retainPathFlags } from "@/features/batch/utils";
import {
  buildBatchAutoQuickActions,
  canStartQueuedMediaAction,
  enqueueMediaQuickAction,
  getAnalysisPrerequisiteStatus,
  hasActiveMediaTask,
  type MediaQuickAction,
  removeMediaQuickAction,
  retainReadyQuickActions,
} from "@/features/media/quick-action-queue";
import {
  buildLatestTaskJobByInput,
  buildLatestTaskOutputPathByInput,
} from "@/features/media/selectors";
import { useMediaController } from "@/features/media/useMediaController";

const RemoveMusicPanel = lazy(() => import("@/components/remove-music-panel"));
const SettingsPanel = lazy(() => import("@/components/settings-panel"));
const SimpleCutEditorPanel = lazy(() => import("@/components/simple-cut-editor-panel"));

const PageLoadingFallback = ({ label }: { label: string }) => (
  <div
    role="status"
    className="rounded-[16px] border border-[#ead3c4] bg-[#fffaf7] px-3 py-4 text-[#8f5e56] text-xs"
  >
    Loading {label}...
  </div>
);

const App = () => {
  const [activePage, setActivePage] = useState<AppPage>(defaultAppPage);
  const [visitedPages, setVisitedPages] = useState<ReadonlySet<AppPage>>(
    () => new Set([defaultAppPage]),
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [removeMusicQuickActionQueue, setRemoveMusicQuickActionQueue] = useState<
    MediaQuickAction[]
  >([]);
  const [autoTranscribePaths, setAutoTranscribePaths] = useState<Record<string, boolean>>({});
  const [autoAnalyzePaths, setAutoAnalyzePaths] = useState<Record<string, boolean>>({});
  const lastAutoActionBatchIdRef = useRef<string | null>(null);
  const [launchingQuickActionId, setLaunchingQuickActionId] = useState<string | null>(null);
  const isLaunchingQuickActionRef = useRef(false);
  const launchQuickActionRef = useRef<(action: MediaQuickAction) => Promise<void>>(async () => {});
  const batchController = useBatchController();
  const mediaController = useMediaController();

  const handleNavigate = (page: AppPage) => {
    setVisitedPages((previous) => addVisitedPage(previous, page));
    setActivePage(page);
  };

  const autoActionsByPath = useMemo(() => {
    const map: Record<string, { autoTranscribe?: boolean; autoAnalyze?: boolean }> = {};
    for (const path of batchController.state.selectedInputPaths) {
      map[path] = {
        autoAnalyze: autoAnalyzePaths[path],
        autoTranscribe: autoTranscribePaths[path],
      };
    }
    return map;
  }, [batchController.state.selectedInputPaths, autoTranscribePaths, autoAnalyzePaths]);

  const handleToggleAutoTranscribe = (path: string, checked: boolean) => {
    setAutoTranscribePaths((prev) => ({ ...prev, [path]: checked }));
    if (!checked) {
      setAutoAnalyzePaths((prev) => ({ ...prev, [path]: false }));
    }
  };

  const handleToggleAutoAnalyze = (path: string, checked: boolean) => {
    setAutoAnalyzePaths((prev) => ({ ...prev, [path]: checked }));
    if (checked) {
      setAutoTranscribePaths((prev) => ({ ...prev, [path]: true }));
    }
  };

  const handleToggleAllAutoTranscribe = (checked: boolean) => {
    const nextTranscribe: Record<string, boolean> = {};
    const nextAnalyze: Record<string, boolean> = { ...autoAnalyzePaths };
    for (const path of batchController.state.selectedInputPaths) {
      nextTranscribe[path] = checked;
      if (!checked) {
        nextAnalyze[path] = false;
      }
    }
    setAutoTranscribePaths(nextTranscribe);
    setAutoAnalyzePaths(nextAnalyze);
  };

  const handleToggleAllAutoAnalyze = (checked: boolean) => {
    const nextAnalyze: Record<string, boolean> = {};
    const nextTranscribe: Record<string, boolean> = { ...autoTranscribePaths };
    for (const path of batchController.state.selectedInputPaths) {
      nextAnalyze[path] = checked;
      if (checked) {
        nextTranscribe[path] = true;
      }
    }
    setAutoAnalyzePaths(nextAnalyze);
    setAutoTranscribePaths(nextTranscribe);
  };

  const transcriptionOutputByInputPath = useMemo(
    () =>
      buildLatestTaskOutputPathByInput(
        mediaController.state.tasksById,
        "transcription",
        mediaController.state.latestJobByKindAndInput,
      ),
    [mediaController.state.latestJobByKindAndInput, mediaController.state.tasksById],
  );
  const analysisOutputByInputPath = useMemo(
    () =>
      buildLatestTaskOutputPathByInput(
        mediaController.state.tasksById,
        "flag",
        mediaController.state.latestJobByKindAndInput,
      ),
    [mediaController.state.latestJobByKindAndInput, mediaController.state.tasksById],
  );
  const transcriptionJobByInputPath = useMemo(
    () =>
      buildLatestTaskJobByInput(
        mediaController.state.tasksById,
        "transcription",
        mediaController.state.latestJobByKindAndInput,
      ),
    [mediaController.state.latestJobByKindAndInput, mediaController.state.tasksById],
  );
  const analysisJobByInputPath = useMemo(
    () =>
      buildLatestTaskJobByInput(
        mediaController.state.tasksById,
        "flag",
        mediaController.state.latestJobByKindAndInput,
      ),
    [mediaController.state.latestJobByKindAndInput, mediaController.state.tasksById],
  );
  const readyQuickActionQueue = useMemo(
    () =>
      retainReadyQuickActions({
        queue: removeMusicQuickActionQueue,
        tasksById: mediaController.state.tasksById,
      }),
    [mediaController.state.tasksById, removeMusicQuickActionQueue],
  );
  const queuedTranscriptionPaths = useMemo(
    () =>
      readyQuickActionQueue
        .filter((action) => action.kind === "transcription")
        .map((action) => action.inputPath),
    [readyQuickActionQueue],
  );
  const queuedAnalysisPaths = useMemo(
    () =>
      readyQuickActionQueue
        .filter((action) => action.kind === "flag")
        .map((action) => action.inputPath),
    [readyQuickActionQueue],
  );
  const hasActiveBatch = batchController.isActive;
  const hasActiveTask = useMemo(
    () => hasActiveMediaTask(mediaController.state.tasksById),
    [mediaController.state.tasksById],
  );

  useEffect(() => {
    const selectedPaths = batchController.state.selectedInputPaths;
    setAutoTranscribePaths((previous) => retainPathFlags(previous, selectedPaths));
    setAutoAnalyzePaths((previous) => retainPathFlags(previous, selectedPaths));
  }, [batchController.state.selectedInputPaths]);

  useEffect(() => {
    if (readyQuickActionQueue.length === removeMusicQuickActionQueue.length) {
      return;
    }

    setRemoveMusicQuickActionQueue(readyQuickActionQueue);
  }, [readyQuickActionQueue, removeMusicQuickActionQueue.length]);

  const handleClearSelectedInputs = () => {
    batchController.setSelectedInputPaths([]);
    setAutoTranscribePaths({});
    setAutoAnalyzePaths({});
    setRemoveMusicQuickActionQueue((queue) =>
      launchingQuickActionId ? queue.filter((action) => action.id === launchingQuickActionId) : [],
    );
  };

  useEffect(() => {
    const activeBatch = batchController.activeBatch;
    if (activeBatch?.status !== "completed") {
      return;
    }

    if (lastAutoActionBatchIdRef.current === activeBatch.batchId) {
      return;
    }

    lastAutoActionBatchIdRef.current = activeBatch.batchId;

    const autoActions = buildBatchAutoQuickActions({
      autoActionsByPath,
      completedJobs: activeBatch.jobs,
    });

    if (autoActions.length > 0) {
      setRemoveMusicQuickActionQueue((queue) => {
        let nextQueue = queue;
        for (const action of autoActions) {
          nextQueue = enqueueMediaQuickAction(nextQueue, action.kind, action.inputPath);
        }
        return nextQueue;
      });
    }
  }, [batchController.activeBatch, autoActionsByPath]);

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
    const nextRunnableAction = readyQuickActionQueue.find(
      (action) =>
        action.kind === "transcription" ||
        getAnalysisPrerequisiteStatus({
          queue: readyQuickActionQueue,
          subtitlePath: action.inputPath,
          tasksById: mediaController.state.tasksById,
        }) === "ready",
    );

    if (
      !canStartQueuedMediaAction({
        hasActiveBatch,
        hasActiveTask,
        isLaunching: isLaunchingQuickActionRef.current,
        queueLength: nextRunnableAction ? 1 : 0,
        workerStatus: mediaController.state.workerStatus,
      })
    ) {
      return;
    }

    const nextAction = nextRunnableAction;
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
    mediaController.state.tasksById,
    readyQuickActionQueue,
  ]);

  return (
    <AppShell
      activePage={activePage}
      isSidebarCollapsed={isSidebarCollapsed}
      onNavigate={handleNavigate}
      onToggleSidebar={() => setIsSidebarCollapsed((previous) => !previous)}
    >
      <section hidden={activePage !== "dashboard"} aria-hidden={activePage !== "dashboard"}>
        <DashboardPanel onNavigate={handleNavigate} />
      </section>
      <section hidden={activePage !== "remove-music"} aria-hidden={activePage !== "remove-music"}>
        {visitedPages.has("remove-music") ? (
          <Suspense fallback={<PageLoadingFallback label="Remove Music" />}>
            <RemoveMusicPanel
              isActive={activePage === "remove-music"}
              selectedInputPaths={batchController.state.selectedInputPaths}
              autoTranscribePaths={autoTranscribePaths}
              autoAnalyzePaths={autoAnalyzePaths}
              onToggleAutoTranscribe={handleToggleAutoTranscribe}
              onToggleAutoAnalyze={handleToggleAutoAnalyze}
              onToggleAllAutoTranscribe={handleToggleAllAutoTranscribe}
              onToggleAllAutoAnalyze={handleToggleAllAutoAnalyze}
              isStartingBatch={batchController.state.isStartingBatch}
              isBatchActive={batchController.isActive}
              workerStatus={batchController.state.workerStatus}
              workerMessage={batchController.state.workerMessage}
              progressPct={batchController.progressPct}
              errorMessage={batchController.state.errorMessage}
              jobs={batchController.jobs}
              onAddInputFiles={batchController.addInputFiles}
              onAddInputFolder={batchController.addInputFolder}
              onAddResolvedInputPaths={batchController.addResolvedInputPaths}
              onClearSelectedInputs={handleClearSelectedInputs}
              onStart={batchController.start}
              onCancel={batchController.cancel}
              onSendToTranscription={async (path) => {
                setRemoveMusicQuickActionQueue((queue) =>
                  enqueueMediaQuickAction(queue, "transcription", path),
                );
              }}
              onSendToAnalysis={async (path) => {
                setRemoveMusicQuickActionQueue((queue) =>
                  enqueueMediaQuickAction(queue, "flag", path),
                );
              }}
              onSendToCut={(path) => {
                mediaController.selectVideo(path);
                handleNavigate("cut-video");
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
          </Suspense>
        ) : null}
      </section>
      <section hidden={activePage !== "cut-video"} aria-hidden={activePage !== "cut-video"}>
        {visitedPages.has("cut-video") ? (
          <Suspense fallback={<PageLoadingFallback label="Edit Video" />}>
            <SimpleCutEditorPanel
              controller={mediaController}
              isActive={activePage === "cut-video"}
            />
          </Suspense>
        ) : null}
      </section>
      <section hidden={activePage !== "settings"} aria-hidden={activePage !== "settings"}>
        {visitedPages.has("settings") ? (
          <Suspense fallback={<PageLoadingFallback label="Settings" />}>
            <SettingsPanel />
          </Suspense>
        ) : null}
      </section>
    </AppShell>
  );
};

export default App;
