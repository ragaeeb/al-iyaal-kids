import { AudioLines, Scissors, ShieldAlert, WandSparkles } from "lucide-react";
import { ProfanityPanel } from "@/components/profanity-panel";
import { RemoveMusicPanel } from "@/components/remove-music-panel";
import { SimpleCutEditorPanel } from "@/components/simple-cut-editor-panel";
import { TranscribePanel } from "@/components/transcribe-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBatchController } from "@/features/batch/useBatchController";
import { useMediaController } from "@/features/media/useMediaController";
import { brandPalette } from "@/theme/brand";
import logoPng from "../logo.png";

const App = () => {
  const controller = useBatchController();
  const mediaController = useMediaController();
  const shellBackground = {
    backgroundImage: `radial-gradient(circle at top left, ${brandPalette.light}, transparent 55%), radial-gradient(circle at 95% 5%, ${brandPalette.muted}55, transparent 45%), linear-gradient(160deg, #fffaf6, #fff6f1 52%, ${brandPalette.light}88)`,
  };

  return (
    <main className="min-h-screen px-5 py-8 text-[#2f1714] lg:px-10" style={shellBackground}>
      <section className="mx-auto w-full max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-start gap-3">
            <img
              src={logoPng}
              alt="al-Iyal Kids logo"
              width={52}
              height={52}
              className="rounded-xl border border-[#d1968f]/50 bg-white/85 object-cover p-1 shadow-sm"
            />
            <div>
              <p className="text-[#88322d] text-xs uppercase tracking-[0.2em]">
                al-Iyal kids tools
              </p>
              <h1 className="mt-1 font-bold text-3xl text-[#88322d] tracking-tight">
                Media Studio
              </h1>
              <p className="mt-2 max-w-2xl text-[#6e3933] text-sm">
                Tauri v2 + Demucs pipeline for local vocals extraction workflows. This MVP ships
                folder batch processing now and keeps the UI shell ready for upcoming video
                utilities.
              </p>
            </div>
          </div>
        </header>

        <Tabs defaultValue="remove-music" className="w-full">
          <TabsList>
            <TabsTrigger value="remove-music" className="gap-2">
              <WandSparkles className="size-4" />
              Remove Music
            </TabsTrigger>
            <TabsTrigger value="transcribe" className="gap-2">
              <AudioLines className="size-4" />
              Transcribe
            </TabsTrigger>
            <TabsTrigger value="profanity-detection" className="gap-2">
              <ShieldAlert className="size-4" />
              Profanity Detection
            </TabsTrigger>
            <TabsTrigger value="cut-video" className="gap-2">
              <Scissors className="size-4" />
              Cut Video
            </TabsTrigger>
          </TabsList>

          <TabsContent value="remove-music">
            <RemoveMusicPanel
              selectedInputDir={controller.state.selectedInputDir}
              isStartingBatch={controller.state.isStartingBatch}
              workerStatus={controller.state.workerStatus}
              workerMessage={controller.state.workerMessage}
              progressPct={controller.progressPct}
              errorMessage={controller.state.errorMessage}
              jobs={controller.jobs}
              onInputDirChange={controller.setSelectedInputDir}
              onChooseInputDir={controller.chooseInputDir}
              onStart={controller.start}
              onCancel={controller.cancel}
              onOpenOutput={controller.openOutput}
              onClearError={controller.clearError}
            />
          </TabsContent>

          <TabsContent value="transcribe">
            <TranscribePanel controller={mediaController} />
          </TabsContent>

          <TabsContent value="profanity-detection">
            <ProfanityPanel controller={mediaController} />
          </TabsContent>

          <TabsContent value="cut-video">
            <SimpleCutEditorPanel controller={mediaController} />
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
};

export default App;
