import { ChevronLeft, ChevronRight, Home } from "lucide-react";

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
    <aside className="flex min-h-0 flex-col border-[#ead3c4] border-r bg-[linear-gradient(180deg,#fffaf7_0%,#fef7f2_100%)] px-3 py-4">
      <div className={cn("mb-3 flex", isCollapsed ? "justify-center" : "justify-end")}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-10 items-center justify-center rounded-2xl border border-[#ead3c4] bg-[#f8e8de] text-[#71443c] transition hover:bg-[#fbefe7] hover:text-[#88322d]"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onNavigate("dashboard")}
        aria-current={activePage === "dashboard" ? "page" : undefined}
        aria-label="Dashboard"
        className={cn(
          "mb-4 flex items-center rounded-2xl px-3 py-3 text-left transition-all",
          isCollapsed ? "justify-center" : "gap-3",
          activePage === "dashboard"
            ? "bg-[#f2dfd2] text-[#6a2924] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            : "text-[#71443c] hover:bg-[#fbefe7] hover:text-[#88322d]",
        )}
        title="Dashboard"
      >
        <img
          src={logoSrc}
          alt="al-Iyaal Kids logo"
          width={34}
          height={34}
          className="rounded-2xl border border-[#d8b7a4] bg-white p-1 shadow-sm"
        />
        {!isCollapsed ? (
          <span className="flex min-w-0 items-center gap-2">
            <Home className="size-4" />
            <span className="truncate font-medium text-sm">Dashboard</span>
          </span>
        ) : null}
      </button>

      <div className="flex flex-col gap-1">
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
                "group flex items-center rounded-2xl px-3 py-3 text-left transition-all",
                isCollapsed ? "justify-center" : "gap-3",
                isActive
                  ? "bg-[#f2dfd2] text-[#6a2924] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                  : "text-[#71443c] hover:bg-[#fbefe7] hover:text-[#88322d]",
              )}
              title={page.label}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-2xl border transition-all",
                  isActive
                    ? "border-[#d3a38f] bg-white text-[#88322d]"
                    : "border-transparent bg-[#f8e8de] text-[#9e5c50] group-hover:border-[#efd5c8] group-hover:bg-white",
                )}
              >
                <Icon className="size-4" />
              </span>
              {!isCollapsed ? (
                <span className="truncate font-medium text-sm">{page.label}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
};

export { SidebarNav };
