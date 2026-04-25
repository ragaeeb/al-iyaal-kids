import type { ReactNode } from "react";

import { SidebarNav } from "@/components/layout/sidebar-nav";
import type { AppPage } from "@/features/app/navigation";

import logoPng from "../../../logo.png";

type AppShellProps = {
  activePage: AppPage;
  children: ReactNode;
  isSidebarCollapsed: boolean;
  onNavigate: (page: AppPage) => void;
  onToggleSidebar: () => void;
};

const AppShell = ({
  activePage,
  children,
  isSidebarCollapsed,
  onNavigate,
  onToggleSidebar,
}: AppShellProps) => {
  return (
    <main className="root h-screen overflow-hidden bg-[linear-gradient(180deg,#f8efe8_0%,#f7f2ed_100%)] text-[var(--text-primary)]">
      <div
        className={`grid h-full min-h-0 w-full overflow-hidden rounded-[18px] border border-[#d9b7a5]/65 bg-[#fffdfb]/96 shadow-[0_20px_50px_rgba(136,50,45,0.12)] backdrop-blur ${
          isSidebarCollapsed ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[160px_minmax(0,1fr)]"
        }`}
      >
        <SidebarNav
          activePage={activePage}
          isCollapsed={isSidebarCollapsed}
          logoSrc={logoPng}
          onNavigate={onNavigate}
          onToggleCollapse={onToggleSidebar}
        />
        <section className="min-h-0 overflow-auto bg-[linear-gradient(180deg,rgba(255,250,246,0.96),rgba(255,247,240,0.92))] px-3 py-2">
          {children}
        </section>
      </div>
    </main>
  );
};

export { AppShell };
