/**
 * Minimal pub/sub store. Views subscribe on mount and unsubscribe on route
 * change. No external dependencies.
 */

export type Unsubscribe = () => void;

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(fn: (prev: T) => T): void;
  subscribe(fn: (state: T) => void, immediate?: boolean): Unsubscribe;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const subscribers = new Set<(state: T) => void>();

  function get(): T {
    return state;
  }

  function set(next: T): void {
    if (Object.is(next, state)) return;
    state = next;
    for (const fn of [...subscribers]) fn(state);
  }

  function update(fn: (prev: T) => T): void {
    set(fn(state));
  }

  function subscribe(fn: (state: T) => void, immediate = false): Unsubscribe {
    subscribers.add(fn);
    if (immediate) fn(state);
    return () => {
      subscribers.delete(fn);
    };
  }

  return { get, set, update, subscribe };
}
