const MAX_JOB_SLUG_LENGTH = 48;
const FNV1A_128_OFFSET_BASIS = 0x6c62272e07bb014262b821756295c58dn;
const FNV1A_128_PRIME = 0x0000000001000000000000000000013bn;
const FNV1A_128_MASK = (1n << 128n) - 1n;

// Keep this format byte-for-byte aligned with Rust and the worker: a
// collapsed ASCII slug (capped at 48 characters) plus an FNV-1a 128-bit
// digest of the original UTF-8 path.
const toJobId = (value: string) => {
  const slug: string[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      (codePoint >= 0x30 && codePoint <= 0x39) ||
      (codePoint >= 0x41 && codePoint <= 0x5a) ||
      (codePoint >= 0x61 && codePoint <= 0x7a)
    ) {
      slug.push(character.toLowerCase());
    } else if (slug.length === 0 || slug.at(-1) !== "-") {
      slug.push("-");
    }
  }

  const readableSlug =
    slug
      .join("")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_JOB_SLUG_LENGTH)
      .replace(/-+$/g, "") || "job";
  let digest = FNV1A_128_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(value)) {
    digest = ((digest ^ BigInt(byte)) * FNV1A_128_PRIME) & FNV1A_128_MASK;
  }

  return `${readableSlug}-${digest.toString(16).padStart(32, "0")}`;
};

export { toJobId };
