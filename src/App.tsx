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
      {activePage === "dashboard" ? <DashboardPanel onNavigate={setActivePage} /> : null}
      {activePage === "remove-music" ? (
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
      ) : null}
      {activePage === "transcribe" ? <TranscribePanel controller={mediaController} /> : null}
      {activePage === "profanity-detection" ? (
        <ProfanityPanel controller={mediaController} />
      ) : null}
      {activePage === "cut-video" ? <SimpleCutEditorPanel controller={mediaController} /> : null}
      {activePage === "analytics" ? <AnalyticsPanel /> : null}
      {activePage === "settings" ? <SettingsPanel /> : null}
    </AppShell>
  );
};

export default App;
