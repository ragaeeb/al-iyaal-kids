const DEFAULT_MAX_BUFFERED_EVENTS = 100;

type BoundedEventBuffer<T> = {
  events: T[];
  maxEvents: number;
};

const createBoundedEventBuffer = <T>(
  maxEvents = DEFAULT_MAX_BUFFERED_EVENTS,
): BoundedEventBuffer<T> => {
  const boundedMaxEvents = Number.isFinite(maxEvents)
    ? Math.max(0, Math.floor(maxEvents))
    : DEFAULT_MAX_BUFFERED_EVENTS;

  return {
    events: [],
    maxEvents: boundedMaxEvents,
  };
};

const appendBoundedEvent = <T>(buffer: BoundedEventBuffer<T>, event: T): BoundedEventBuffer<T> => {
  if (buffer.maxEvents === 0) {
    return buffer;
  }

  const events = [...buffer.events, event];
  return {
    ...buffer,
    events: events.length > buffer.maxEvents ? events.slice(-buffer.maxEvents) : events,
  };
};

const drainBoundedEventBuffer = <T>(buffer: BoundedEventBuffer<T>) => ({
  buffer: {
    ...buffer,
    events: [],
  },
  events: [...buffer.events],
});

const clearBoundedEventBuffer = <T>(buffer: BoundedEventBuffer<T>): BoundedEventBuffer<T> => ({
  ...buffer,
  events: [],
});

export type { BoundedEventBuffer };
export {
  appendBoundedEvent,
  clearBoundedEventBuffer,
  createBoundedEventBuffer,
  DEFAULT_MAX_BUFFERED_EVENTS,
  drainBoundedEventBuffer,
};
