import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/cn";

const Tabs = TabsPrimitive.Root;

const TabsList = ({ className, ...props }: TabsPrimitive.TabsListProps) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-8 items-center gap-0.5 rounded-md border border-[#d1968f]/45 bg-[#f1d1b1]/45 p-0.5",
      className,
    )}
    {...props}
  />
);

const TabsTrigger = ({ className, ...props }: TabsPrimitive.TabsTriggerProps) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex h-6 items-center justify-center rounded-sm px-2 font-medium text-[#6e3933] text-xs transition data-[state=active]:bg-white data-[state=active]:text-[#88322d] data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
);

const TabsContent = ({ className, ...props }: TabsPrimitive.TabsContentProps) => (
  <TabsPrimitive.Content className={cn("mt-2", className)} {...props} />
);

export { Tabs, TabsContent, TabsList, TabsTrigger };
