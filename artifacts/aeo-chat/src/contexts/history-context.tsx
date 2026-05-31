import { createContext, useContext, useState, useEffect, useCallback } from "react";

export type HistoryEntryType = "Business Analyzer" | "Full AEO Audit";

export type HistoryEntry = {
  id: string;
  type: HistoryEntryType;
  businessName: string;
  timestamp: string;
  traceUrl?: string | null;
  result: unknown;
};

type HistoryContextValue = {
  entries: HistoryEntry[];
  addEntry: (entry: Omit<HistoryEntry, "id" | "timestamp">) => HistoryEntry;
  selectedEntry: HistoryEntry | null;
  selectEntry: (entry: HistoryEntry | null) => void;
  clearHistory: () => void;
};

const HistoryContext = createContext<HistoryContextValue | null>(null);

const STORAGE_KEY = "signal-aeo-history";
const MAX_ENTRIES = 50;

export function HistoryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  const addEntry = useCallback((entry: Omit<HistoryEntry, "id" | "timestamp">) => {
    const newEntry: HistoryEntry = {
      ...entry,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
    };
    setEntries((prev) => [newEntry, ...prev].slice(0, MAX_ENTRIES));
    return newEntry;
  }, []);

  const selectEntry = useCallback((entry: HistoryEntry | null) => {
    setSelectedEntry(entry);
  }, []);

  const clearHistory = useCallback(() => {
    setEntries([]);
    setSelectedEntry(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <HistoryContext.Provider value={{ entries, addEntry, selectedEntry, selectEntry, clearHistory }}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory() {
  const ctx = useContext(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used within HistoryProvider");
  return ctx;
}
