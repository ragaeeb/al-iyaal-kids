import { describe, expect, it } from "bun:test";

import {
  appendBoundedEvent,
  clearBoundedEventBuffer,
  createBoundedEventBuffer,
  DEFAULT_MAX_BUFFERED_EVENTS,
  drainBoundedEventBuffer,
} from "@/features/shared/bounded-event-buffer";

describe("bounded event buffer", () => {
  it("should retain buffered events in order within the configured bound", () => {
    let buffer = createBoundedEventBuffer<number>(2);
    buffer = appendBoundedEvent(buffer, 1);
    buffer = appendBoundedEvent(buffer, 2);
    buffer = appendBoundedEvent(buffer, 3);

    expect(buffer.events).toEqual([2, 3]);
  });

  it("should drain events and return an empty reusable buffer", () => {
    const buffer = appendBoundedEvent(createBoundedEventBuffer<string>(3), "event");

    const drained = drainBoundedEventBuffer(buffer);

    expect(drained.events).toEqual(["event"]);
    expect(drained.buffer.events).toEqual([]);
    expect(drained.buffer.maxEvents).toBe(3);
  });

  it("should clear events without changing the configured bound", () => {
    const buffer = appendBoundedEvent(createBoundedEventBuffer<number>(4), 1);

    const cleared = clearBoundedEventBuffer(buffer);

    expect(cleared).toEqual({ events: [], maxEvents: 4 });
  });

  it("should fall back to the default bound for non-finite limits", () => {
    expect(createBoundedEventBuffer(Number.NaN).maxEvents).toBe(DEFAULT_MAX_BUFFERED_EVENTS);
  });
});
