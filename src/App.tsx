import { useState } from "react";

import { AnalyticsPanel } from "@/components/analytics-panel";
import { DashboardPanel } from "@/components/dashboard-panel";
import { AppShell } from "@/components/layout/app-shell";
import { ProfanityPanel } from "@/components/profanity-panel";
import { RemoveMusicPanel } from "@/components/remove-music-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { SimpleCutEditorPanel } from "@/components/simple-cut-editor-panel";
import { TranscribePanel } from "@/components/transcribe-panel";
import { type AppPage, defaultAppPage } from "@/features/app/navigation";
import { useBatchController } from "@/features/batch/useBatchController";
import { useMediaController } from "@/features/media/useMediaController";

const App = () => {
  const [activePage, setActivePage] = useState<AppPage>(defaultAppPage);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const batchController = useBatchController();
  const mediaController = useMediaController();

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
          selectedInputDir={batchController.state.selectedInputDir}
          isStartingBatch={batchController.state.isStartingBatch}
          workerStatus={batchController.state.workerStatus}
          workerMessage={batchController.state.workerMessage}
          progressPct={batchController.progressPct}
          errorMessage={batchController.state.errorMessage}
          jobs={batchController.jobs}
          onInputDirChange={batchController.setSelectedInputDir}
          onChooseInputDir={batchController.chooseInputDir}
          onStart={batchController.start}
          onCancel={batchController.cancel}
          onOpenOutput={batchController.openOutput}
          onClearError={batchController.clearError}
        />
      </section>
      <section hidden={activePage !== "transcribe"} aria-hidden={activePage !== "transcribe"}>
        <TranscribePanel controller={mediaController} />
      </section>
      <section
        hidden={activePage !== "profanity-detection"}
        aria-hidden={activePage !== "profanity-detection"}
      >
        <ProfanityPanel controller={mediaController} />
      </section>
      <section hidden={activePage !== "cut-video"} aria-hidden={activePage !== "cut-video"}>
        <SimpleCutEditorPanel controller={mediaController} />
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
