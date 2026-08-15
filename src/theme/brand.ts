type BadgeVariant = "queued" | "running" | "completed" | "failed" | "cancelled";

const statusClassByVariant: Record<BadgeVariant, string> = {
  cancelled: "bg-[#d1968f]/35 text-[#88322d]",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  queued: "bg-[#f1d1b1]/45 text-[#88322d]",
  running: "bg-[#d1968f]/45 text-[#88322d]",
};

export type { BadgeVariant };
export { statusClassByVariant };
