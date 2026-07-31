import { ChevronLeft, ChevronRight, Home } from "lucide-react";

import { SystemLogDrawer } from "@/components/system-log-drawer";
import { type AppPage, appPages } from "@/features/app/navigation";
import { cn } from "@/lib/cn";

type SidebarNavProps = {
  activePage: AppPage;
  isCollapsed: boolean;
  logoSrc: string;
  onNavigate: (page: AppPage) => void;
  onToggleCollapse: () => void;
};

const SidebarNav = ({
  activePage,
  isCollapsed,
  logoSrc,
  onNavigate,
  onToggleCollapse,
}: SidebarNavProps) => {
  return (
    <aside className="flex min-h-0 flex-col border-[#ead3c4] border-r bg-[linear-gradient(180deg,#fffaf7_0%,#fef7f2_100%)] px-1.5 py-2">
      <div className={cn("mb-1 flex", isCollapsed ? "justify-center" : "justify-end")}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-6 items-center justify-center rounded-lg border border-[#ead3c4] bg-[#f8e8de] text-[#71443c] transition hover:bg-[#fbefe7] hover:text-[#88322d]"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onNavigate("dashboard")}
        aria-current={activePage === "dashboard" ? "page" : undefined}
        aria-label="Dashboard"
        className={cn(
          "mb-1.5 flex items-center rounded-lg px-1.5 py-1 text-left transition-all",
          isCollapsed ? "justify-center" : "gap-1.5",
          activePage === "dashboard"
            ? "bg-[#f2dfd2] text-[#6a2924] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            : "text-[#71443c] hover:bg-[#fbefe7] hover:text-[#88322d]",
        )}
        title="Dashboard"
      >
        <img
          src={logoSrc}
          alt="al-Iyaal Kids logo"
          width={20}
          height={20}
          className="rounded-lg border border-[#d8b7a4] bg-white p-0.5 shadow-sm"
        />
        {!isCollapsed ? (
          <span className="flex min-w-0 items-center gap-1">
            <Home className="size-3" />
            <span className="truncate font-medium text-xs">Dashboard</span>
          </span>
        ) : null}
      </button>

      <div className="flex flex-col gap-0.5">
        {appPages.map((page) => {
          const Icon = page.icon;
          const isActive = page.key === activePage;

          return (
            <button
              key={page.key}
              type="button"
              onClick={() => onNavigate(page.key)}
              aria-current={isActive ? "page" : undefined}
              aria-label={page.label}
              className={cn(
                "group flex items-center rounded-lg px-1.5 py-1 text-left transition-all",
                isCollapsed ? "justify-center" : "gap-1.5",
                isActive
                  ? "bg-[#f2dfd2] text-[#6a2924] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                  : "text-[#71443c] hover:bg-[#fbefe7] hover:text-[#88322d]",
              )}
              title={page.label}
            >
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-lg border transition-all",
                  isActive
                    ? "border-[#d3a38f] bg-white text-[#88322d]"
                    : "border-transparent bg-[#f8e8de] text-[#9e5c50] group-hover:border-[#efd5c8] group-hover:bg-white",
                )}
              >
                <Icon className="size-2.5" />
              </span>
              {!isCollapsed ? (
                <span className="truncate font-medium text-xs">{page.label}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-auto border-[#ead3c4]/60 border-t pt-1.5">
        <SystemLogDrawer isSidebarCollapsed={isCollapsed} />
      </div>
    </aside>
  );
};

export { SidebarNav };
