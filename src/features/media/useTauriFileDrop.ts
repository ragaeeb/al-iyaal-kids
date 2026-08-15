import type { DragDropEvent } from "@tauri-apps/api/window";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useEffect, useRef, useState } from "react";

type DropPosition = {
  x: number;
  y: number;
};

type UseTauriFileDropOptions = {
  enabled: boolean;
  onDrop: (paths: string[]) => void | Promise<void>;
  onError?: (error: unknown) => void;
  resolvePaths: (paths: string[]) => Promise<string[]>;
};

type TauriFileDropState<T extends HTMLElement> = {
  dropTargetRef: RefObject<T | null>;
  isDropTargetActive: boolean;
  isResolvingDrop: boolean;
};

type DropResolutionContext = {
  isCurrent: () => boolean;
  onDrop: (paths: string[]) => void | Promise<void>;
  onError?: (error: unknown) => void;
  pendingResolutionCountRef: { current: number };
  resolvePaths: (paths: string[]) => Promise<string[]>;
  setIsResolvingDrop: (value: boolean) => void;
};

const isPointWithinRect = (
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  position: DropPosition,
) =>
  position.x >= rect.left &&
  position.x <= rect.right &&
  position.y >= rect.top &&
  position.y <= rect.bottom;

const isPointWithinDropTarget = (
  targetRef: RefObject<HTMLElement | null>,
  position: DropPosition,
) => {
  const element = targetRef.current;
  return element ? isPointWithinRect(element.getBoundingClientRect(), position) : false;
};

const processDropResolution = async (
  paths: string[],
  {
    isCurrent,
    onDrop,
    onError,
    pendingResolutionCountRef,
    resolvePaths,
    setIsResolvingDrop,
  }: DropResolutionContext,
) => {
  pendingResolutionCountRef.current += 1;
  if (isCurrent()) {
    setIsResolvingDrop(true);
  }

  try {
    const resolvedPaths = await resolvePaths(paths);
    if (isCurrent()) {
      await onDrop(resolvedPaths);
    }
  } catch (error: unknown) {
    if (isCurrent()) {
      onError?.(error);
    }
  } finally {
    pendingResolutionCountRef.current = Math.max(0, pendingResolutionCountRef.current - 1);
    if (isCurrent() && pendingResolutionCountRef.current === 0) {
      setIsResolvingDrop(false);
    }
  }
};

const useTauriFileDrop = <T extends HTMLElement>({
  enabled,
  onDrop,
  onError,
  resolvePaths,
}: UseTauriFileDropOptions): TauriFileDropState<T> => {
  const [isDropTargetActive, setIsDropTargetActive] = useState(false);
  const [isResolvingDrop, setIsResolvingDrop] = useState(false);
  const dropTargetRef = useRef<T>(null);
  const generationRef = useRef(0);
  const onDropRef = useRef(onDrop);
  const onErrorRef = useRef(onError);
  const resolvePathsRef = useRef(resolvePaths);

  onDropRef.current = onDrop;
  onErrorRef.current = onError;
  resolvePathsRef.current = resolvePaths;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const pendingResolutionCountRef = { current: 0 };
    let disposed = false;
    let unlisten: (() => void) | undefined;

    if (!enabled) {
      setIsDropTargetActive(false);
      setIsResolvingDrop(false);
      return;
    }

    const isCurrent = () => !disposed && generationRef.current === generation;

    const handleEvent = (event: { payload: DragDropEvent }) => {
      if (!isCurrent()) {
        return;
      }

      const payload = event.payload;
      if (payload.type === "leave") {
        setIsDropTargetActive(false);
        return;
      }

      if (payload.type === "enter" || payload.type === "over") {
        setIsDropTargetActive(isPointWithinDropTarget(dropTargetRef, payload.position));
        return;
      }

      setIsDropTargetActive(false);
      if (!isPointWithinDropTarget(dropTargetRef, payload.position)) {
        return;
      }

      void processDropResolution(payload.paths, {
        isCurrent,
        onDrop: onDropRef.current,
        onError: onErrorRef.current,
        pendingResolutionCountRef,
        resolvePaths: resolvePathsRef.current,
        setIsResolvingDrop,
      });
    };

    const setup = async () => {
      const registeredUnlisten = await getCurrentWindow().onDragDropEvent(handleEvent);
      if (!isCurrent()) {
        registeredUnlisten();
        return;
      }

      unlisten = registeredUnlisten;
    };

    void setup().catch((error: unknown) => {
      if (isCurrent()) {
        setIsDropTargetActive(false);
        setIsResolvingDrop(false);
        onErrorRef.current?.(error);
      }
    });

    return () => {
      disposed = true;
      generationRef.current += 1;
      pendingResolutionCountRef.current = 0;
      unlisten?.();
    };
  }, [enabled]);

  return {
    dropTargetRef,
    isDropTargetActive,
    isResolvingDrop,
  };
};

export type { DropPosition, TauriFileDropState, UseTauriFileDropOptions };
export { isPointWithinRect, processDropResolution, useTauriFileDrop };
