const TRUNCATION_MARKER = "... [truncated]";

const truncateText = (value: string, maxCharacters: number, marker = TRUNCATION_MARKER) => {
  const limit = Math.max(0, Math.floor(maxCharacters));
  if (limit === 0) {
    return "";
  }

  let characterCount = 0;
  let endOffset = 0;
  for (const character of value) {
    if (characterCount >= limit) {
      return `${value.slice(0, endOffset)}${marker}`;
    }
    characterCount += 1;
    endOffset += character.length;
  }

  return value;
};

export { TRUNCATION_MARKER, truncateText };
