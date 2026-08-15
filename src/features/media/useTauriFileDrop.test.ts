import { describe, expect, it } from "bun:test";

import { isPointWithinRect, processDropResolution } from "@/features/media/useTauriFileDrop";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
};

describe("Tauri file drop helpers", () => {
  it("should treat the drop target boundary as inclusive", () => {
    const rect = { bottom: 200, left: 100, right: 300, top: 50 };

    expect(isPointWithinRect(rect, { x: 100, y: 50 })).toBe(true);
    expect(isPointWithinRect(rect, { x: 300, y: 200 })).toBe(true);
    expect(isPointWithinRect(rect, { x: 301, y: 200 })).toBe(false);
  });

  it("should isolate pending counts between listener generations", async () => {
    const staleResolution = createDeferred<string[]>();
    const currentResolution = createDeferred<string[]>();
    const staleCount = { current: 0 };
    const currentCount = { current: 0 };
    const stateChanges: boolean[] = [];

    const staleTask = processDropResolution(["stale"], {
      isCurrent: () => false,
      onDrop: () => {},
      pendingResolutionCountRef: staleCount,
      resolvePaths: () => staleResolution.promise,
      setIsResolvingDrop: (value) => stateChanges.push(value),
    });
    const currentTask = processDropResolution(["current"], {
      isCurrent: () => true,
      onDrop: () => {},
      pendingResolutionCountRef: currentCount,
      resolvePaths: () => currentResolution.promise,
      setIsResolvingDrop: (value) => stateChanges.push(value),
    });

    expect(staleCount.current).toBe(1);
    expect(currentCount.current).toBe(1);
    staleResolution.resolve([]);
    await staleTask;
    expect(currentCount.current).toBe(1);

    currentResolution.resolve([]);
    await currentTask;
    expect(currentCount.current).toBe(0);
    expect(stateChanges).toEqual([true, false]);
  });
});
