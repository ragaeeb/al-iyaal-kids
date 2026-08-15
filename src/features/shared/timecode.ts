const parseFlexibleTimeToSeconds = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parts = value.trim().replace(",", ".").split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !part)) {
    return null;
  }
  const values = parts.map(Number);
  if (values.some((part) => !Number.isFinite(part))) {
    return null;
  }
  if ((values[0] ?? -1) < 0 || values.slice(1).some((part) => part < 0 || part >= 60)) {
    return null;
  }
  return values.reduce((total, part) => total * 60 + part, 0);
};

export { parseFlexibleTimeToSeconds };
