import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepairCase } from "../shared/types";
import { api } from "./api";

export const useRepairCases = () => {
  const [cases, setCases] = useState<RepairCase[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refresh = useCallback(async (preferredId?: string) => {
    setError(undefined);
    try {
      const nextCases = await api.listCases();
      setCases(nextCases);
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

  return {
    cases,
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
    clearError: () => setError(undefined),
  };
};
