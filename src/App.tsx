import { useMemo, useState } from "react";

import { AnalyticsPanel } from "@/components/analytics-panel";
import { DashboardPanel } from "@/components/dashboard-panel";
import { AppShell } from "@/components/layout/app-shell";
import { RemoveMusicPanel } from "@/components/remove-music-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { SimpleCutEditorPanel } from "@/components/simple-cut-editor-panel";
import { type AppPage, defaultAppPage } from "@/features/app/navigation";
import { trashFile } from "@/features/batch/transport";
import { useBatchController } from "@/features/batch/useBatchController";
import { buildLatestTaskOutputPathByInput } from "@/features/media/selectors";
import { useMediaController } from "@/features/media/useMediaController";

const App = () => {
  const [activePage, setActivePage] = useState<AppPage>(defaultAppPage);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
            await mediaController.startTranscriptionForPaths([path]);
            mediaController.selectVideo(path);
            setActivePage("cut-video");
          }}
          onSendToProfanity={async (path) => {
            await mediaController.startFlaggingForPaths([path]);
            mediaController.selectVideo(videoPathBySubtitlePath[path] ?? null);
            setActivePage("cut-video");
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
