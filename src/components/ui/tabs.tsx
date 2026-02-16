import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/cn";

const Tabs = TabsPrimitive.Root;

const TabsList = ({ className, ...props }: TabsPrimitive.TabsListProps) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-11 items-center gap-2 rounded-lg border border-[#d1968f]/45 bg-[#f1d1b1]/45 p-1",
      className,
    )}
    {...props}
  />
);

const TabsTrigger = ({ className, ...props }: TabsPrimitive.TabsTriggerProps) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-md px-4 font-medium text-[#6e3933] text-sm transition data-[state=active]:bg-white data-[state=active]:text-[#88322d] data-[state=active]:shadow",
      className,
    )}
    {...props}
  />
);

const TabsContent = ({ className, ...props }: TabsPrimitive.TabsContentProps) => (
  <TabsPrimitive.Content className={cn("mt-6", className)} {...props} />
);

export { Tabs, TabsContent, TabsList, TabsTrigger };
