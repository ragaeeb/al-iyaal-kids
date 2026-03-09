const isAlphaNumeric = (value: string) => /[\p{L}\p{N}]/u.test(value);

const toJobId = (value: string) => {
  const normalized = value.toLocaleLowerCase();
  const mapped = Array.from(normalized, (character) =>
    isAlphaNumeric(character) ? character : "-",
  ).join("");
  const trimmed = mapped.replace(/^-+|-+$/g, "");
  return trimmed.length > 0 ? trimmed : "job";
};

export { toJobId };
