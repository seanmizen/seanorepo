type EventCallback = (data?: unknown) => void;

/**
 * Simple event bus for pub/sub messaging.
 */
class EventBus {
  private events: Map<string, EventCallback[]> = new Map();

  on(event: string, callback: EventCallback) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)?.push(callback);
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.events.get(event);
    if (callbacks) {
      this.events.set(
        event,
        callbacks.filter((cb) => cb !== callback),
      );
    }
  }

  emit(event: string, data?: unknown) {
    const callbacks = this.events.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(data);
      }
    }
  }
}

export const eventBus = new EventBus();

let snackbarIdCounter = 0;

/**
 * Shows a snackbar notification.
 */
export const showSnackbar = (
  message: string,
  severity: 'success' | 'error' | 'info' | 'warning' = 'info',
  key?: string,
  noExpiry = false,
) => {
  const id = key || `snackbar-${snackbarIdCounter++}`;
  eventBus.emit('snackbar:add', { id, message, severity, noExpiry });
  return id;
};

/**
 * Updates an existing snackbar.
 */
export const updateSnackbar = (
  key: string,
  message: string,
  severity: 'success' | 'error' | 'info' | 'warning',
  noExpiry = false,
) => {
  eventBus.emit('snackbar:update', { id: key, message, severity, noExpiry });
};

/**
 * Removes a snackbar by key.
 */
export const removeSnackbar = (key: string) => {
  eventBus.emit('snackbar:remove', { id: key });
};
