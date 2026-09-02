import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepairCase } from "../shared/types";
import { api } from "./api";

export const startSharedCasePolling = ({
  refresh,
  hidden = () => document.hidden,
  schedule = window.setInterval,
  cancel = window.clearInterval,
}: {
  refresh: () => Promise<unknown>;
  hidden?: () => boolean;
  schedule?: (callback: () => void, milliseconds: number) => number;
  cancel?: (interval: number) => void;
}) => {
  // ponytail: three-second polling is enough for one bounded live demo; use push if latency or scale demands it.
  const interval = schedule(() => {
    if (!hidden()) void refresh();
  }, 3000);
  return () => cancel(interval);
};

export const useRepairCases = () => {
  const [cases, setCases] = useState<RepairCase[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [controlledLiveMode, setControlledLiveMode] = useState<boolean>();
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async (preferredId?: string) => {
    setError(undefined);
    try {
      const {
        cases: nextCases,
        demoMode: nextDemoMode,
        controlledLiveMode: nextControlledLiveMode,
      } = await api.listCases();
      setCases(nextCases);
      setDemoMode(nextDemoMode);
      setControlledLiveMode(nextControlledLiveMode);
      setSelectedId((current) => {
        const candidate = preferredId ?? current;
        return candidate && nextCases.some((item) => item.id === candidate)
          ? candidate
          : nextCases[0]?.id;
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load repairs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!controlledLiveMode) return;
    return startSharedCasePolling({ refresh });
  }, [controlledLiveMode, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(undefined), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selected = useMemo(
    () => cases.find((item) => item.id === selectedId),
    [cases, selectedId],
  );

  const replaceCase = useCallback((repair: RepairCase) => {
    setCases((current) => {
      const next = current.some((item) => item.id === repair.id)
        ? current.map((item) => (item.id === repair.id ? repair : item))
        : [repair, ...current];
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
    setSelectedId(repair.id);
  }, []);

  const run = useCallback(
    async (label: string, operation: () => Promise<RepairCase>, success: string) => {
      setBusy(label);
      setError(undefined);
      try {
        const repair = await operation();
        replaceCase(repair);
        setNotice(success);
        return repair;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The action could not be completed.");
        throw reason;
      } finally {
        setBusy(undefined);
      }
    },
    [replaceCase],
  );

  const resetDemo = useCallback(async () => {
    setBusy("demo-reset");
    setError(undefined);
    try {
      const { caseId } = await api.resetDemo();
      await refresh(caseId);
      setNotice("Synthetic demo reset to a clean repair.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The synthetic demo could not be reset.");
      throw reason;
    } finally {
      setBusy(undefined);
    }
  }, [refresh]);

  return {
    cases,
    demoMode,
    controlledLiveMode,
    selected,
    selectedId,
    loading,
    busy,
    error,
    notice,
    selectCase: setSelectedId,
    refresh,
    replaceCase,
    run,
    resetDemo,
    clearError: () => setError(undefined),
  };
};
