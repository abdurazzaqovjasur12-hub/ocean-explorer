// The visitor's day / night choice, remembered between visits. Day is the default.
const STORAGE_KEY = 'ocean-explorer.mode';

export function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'day' || value === 'night' ? value : null;
  } catch {
    return null; // private mode, blocked storage
  }
}

export function saveMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* not remembered, still switched */
  }
}
