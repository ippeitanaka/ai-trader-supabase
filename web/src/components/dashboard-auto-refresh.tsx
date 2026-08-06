"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export function DashboardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        router.refresh();
      });
    };

    const intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  return null;
}