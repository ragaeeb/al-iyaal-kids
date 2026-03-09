import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type PageHeaderProps = {
  title: string;
  description: string;
};

const PageHeader = ({ title, description }: PageHeaderProps) => {
  return (
    <header className="border-[#ead3c4] border-b px-8 py-6">
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="font-medium text-[#9e5c50] text-[11px] uppercase tracking-[0.26em]">
            Desktop workspace
          </p>
          <h1 className="mt-3 text-4xl text-[#88322d] tracking-tight">{title}</h1>
          <p className="mt-2 max-w-3xl text-[#7f524a] text-sm leading-6">{description}</p>
        </div>
        <div className="hidden w-full max-w-md items-center gap-3 rounded-[22px] border border-[#ead3c4] bg-white/80 px-4 py-3 shadow-[0_10px_30px_rgba(136,50,45,0.06)] xl:flex">
          <Search className="size-4 text-[#9e5c50]" />
          <Input
            aria-label="Workspace search placeholder"
            value=""
            readOnly
            className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
            placeholder="Search tasks, logs, and exports"
          />
        </div>
      </div>
    </header>
  );
};

export { PageHeader };
