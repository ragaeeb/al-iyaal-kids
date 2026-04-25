import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type PageHeaderProps = {
  title: string;
  description: string;
};

const PageHeader = ({ title, description }: PageHeaderProps) => {
  return (
    <header className="border-[var(--border-soft)] border-b px-3 py-2">
      <div className="flex flex-col items-start justify-between gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div>
          <h1 className="mt-0.5 text-lg text-[var(--brand-dark)] tracking-tight">{title}</h1>
          <p className="mt-0.5 max-w-3xl text-[var(--text-secondary)] text-xs leading-4">
            {description}
          </p>
        </div>
        <div className="hidden w-full max-w-sm items-center gap-2 rounded-[14px] border border-[var(--border-soft)] bg-white/80 px-2.5 py-1.5 shadow-[0_6px_20px_rgba(136,50,45,0.06)] lg:flex">
          <Search className="size-3.5 text-[var(--text-muted)]" />
          <Input
            aria-label="Workspace search placeholder"
            aria-disabled="true"
            disabled
            className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
            placeholder="Search (Coming soon)"
          />
        </div>
      </div>
    </header>
  );
};

export { PageHeader };
