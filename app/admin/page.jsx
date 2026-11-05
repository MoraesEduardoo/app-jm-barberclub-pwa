"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import AgendaPage from "./agenda/page";

export default function AdminIndexPage() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/admin" || pathname === "/") {
      router.replace("/admin/agenda");
    }
  }, [pathname, router]);

  return <AgendaPage />;
}
