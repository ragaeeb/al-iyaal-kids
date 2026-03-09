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
    <main className="root min-h-screen bg-[linear-gradient(180deg,#f8efe8_0%,#f7f2ed_100%)] px-4 py-4 text-[var(--text-primary)]">
      <div
        className={`mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1680px] overflow-hidden rounded-[28px] border border-[#d9b7a5]/65 bg-[#fffdfb]/96 shadow-[0_28px_70px_rgba(136,50,45,0.12)] backdrop-blur ${
          isSidebarCollapsed ? "grid-cols-[84px_minmax(0,1fr)]" : "grid-cols-[220px_minmax(0,1fr)]"
        }`}
      >
        <SidebarNav
          activePage={activePage}
          isCollapsed={isSidebarCollapsed}
          logoSrc={logoPng}
          onNavigate={onNavigate}
          onToggleCollapse={onToggleSidebar}
        />
        <section className="min-h-0 overflow-auto bg-[linear-gradient(180deg,rgba(255,250,246,0.96),rgba(255,247,240,0.92))] px-5 py-5">
          {children}
        </section>
      </div>
    </main>
  );
};

export { AppShell };
