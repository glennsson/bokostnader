import { useCallback, useState } from "react";
import { formatSupabaseError, listCloudSnapshots } from "./cloudStorage";
import { isCloudEnabled } from "./supabaseClient";
import { getSnapshotMeta } from "./snapshotMeta";
import { loadSavedState } from "./storage";

function localSnapshotRow() {
  const payload = loadSavedState();
  if (!payload) {
    return null;
  }

  const meta = getSnapshotMeta(payload);
  return {
    id: "local",
    navn: meta.navn,
    total_maanedlig: meta.totalMaanedlig,
    created_at: payload.savedAt,
    updated_at: payload.savedAt,
    payload,
    isAutolagret: true,
    isLocalOnly: true,
  };
}

export function useSavedSimulations(user) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      if (user && isCloudEnabled) {
        const data = await listCloudSnapshots();
        setRows(data);
        return;
      }

      const localRow = localSnapshotRow();
      setRows(localRow ? [localRow] : []);
    } catch (loadError) {
      setError(formatSupabaseError(loadError));
      const localRow = localSnapshotRow();
      setRows(localRow ? [localRow] : []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  return { rows, loading, error, refresh };
}
