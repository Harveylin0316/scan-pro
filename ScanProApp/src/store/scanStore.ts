import { create } from 'zustand';

export type Filter = 'scan' | 'bw' | 'gray' | 'color';

export interface Corner {
  x: number; // 0–1 normalized to image dimensions
  y: number;
}

export interface ScanPage {
  id: string;
  originalUri: string;
  processedBase64: string; // full JPEG data URL
  thumbBase64: string;     // small JPEG data URL
  corners: Corner[];
  filter: Filter;
  brightness: number; // -50 to 50
  contrast: number;   // -50 to 50
}

interface ScanStore {
  pages: ScanPage[];
  addPage: (page: ScanPage) => void;
  updatePage: (id: string, updates: Partial<ScanPage>) => void;
  removePage: (id: string) => void;
  movePageUp: (id: string) => void;
  movePageDown: (id: string) => void;
  clearPages: () => void;
}

export const useScanStore = create<ScanStore>((set) => ({
  pages: [],

  addPage: (page) =>
    set((s) => ({ pages: [...s.pages, page] })),

  updatePage: (id, updates) =>
    set((s) => ({
      pages: s.pages.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),

  removePage: (id) =>
    set((s) => ({ pages: s.pages.filter((p) => p.id !== id) })),

  movePageUp: (id) =>
    set((s) => {
      const i = s.pages.findIndex((p) => p.id === id);
      if (i <= 0) return s;
      const pages = [...s.pages];
      [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
      return { pages };
    }),

  movePageDown: (id) =>
    set((s) => {
      const i = s.pages.findIndex((p) => p.id === id);
      if (i < 0 || i >= s.pages.length - 1) return s;
      const pages = [...s.pages];
      [pages[i], pages[i + 1]] = [pages[i + 1], pages[i]];
      return { pages };
    }),

  clearPages: () => set({ pages: [] }),
}));
