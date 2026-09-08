import { useEffect, useRef, useState } from 'react';

export type Page = 'chat' | 'scheduled' | 'plugins' | 'settings';
export type Location = { page: Page; threadId?: string };

export function useNavigationHistory(location: Location, isAvailable: (location: Location) => boolean) {
  const history = useRef({ entries: [location], index: 0 });
  const [, refresh] = useState(0);
  useEffect(() => {
    const current = history.current;
    const previous = current.entries[current.index];
    if (previous.page === location.page && previous.threadId === location.threadId) return;
    current.entries = [...current.entries.slice(0, current.index + 1), location];
    current.index = current.entries.length - 1;
    refresh(value => value + 1);
  }, [location.page, location.threadId]);

  const findIndex = (direction: -1 | 1) => {
    const current = history.current;
    for (let index = current.index + direction; index >= 0 && index < current.entries.length; index += direction) {
      if (isAvailable(current.entries[index])) return index;
    }
    return -1;
  };

  return {
    canGoBack: findIndex(-1) >= 0,
    canGoForward: findIndex(1) >= 0,
    move(direction: -1 | 1) {
      const index = findIndex(direction);
      if (index < 0) return;
      // Move the cursor before restoring the route so it is not recorded as a new visit.
      history.current.index = index;
      refresh(value => value + 1);
      return history.current.entries[index];
    },
  };
}
