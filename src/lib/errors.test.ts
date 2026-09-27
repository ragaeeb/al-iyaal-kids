import { describe, expect, it } from "bun:test";
import { toErrorMessage } from "./errors";

describe("toErrorMessage", () => {
  it("should return the string directly when error is a non-empty string", () => {
    expect(toErrorMessage("Custom backend failure", "Default fallback")).toBe(
      "Custom backend failure",
    );
  });

  it("should trim the error string", () => {
    expect(toErrorMessage("  Padded error message  ", "Default fallback")).toBe(
      "Padded error message",
    );
  });

  it("should return error.message when error is an Error instance", () => {
    expect(toErrorMessage(new Error("Something exploded"), "Default fallback")).toBe(
      "Something exploded",
    );
  });

  it("should return message property when error is an object with a message string", () => {
    expect(toErrorMessage({ message: "Object with message" }, "Default fallback")).toBe(
      "Object with message",
    );
  });

  it("should return fallback when string is empty or whitespace", () => {
    expect(toErrorMessage("", "Default fallback")).toBe("Default fallback");
    expect(toErrorMessage("   ", "Default fallback")).toBe("Default fallback");
  });

  it("should return fallback when Error message is empty", () => {
    expect(toErrorMessage(new Error(""), "Default fallback")).toBe("Default fallback");
  });

  it("should return fallback for null, undefined, numbers, or boolean values", () => {
    expect(toErrorMessage(null, "Default fallback")).toBe("Default fallback");
    expect(toErrorMessage(undefined, "Default fallback")).toBe("Default fallback");
    expect(toErrorMessage(404, "Default fallback")).toBe("Default fallback");
    expect(toErrorMessage(false, "Default fallback")).toBe("Default fallback");
  });
});
