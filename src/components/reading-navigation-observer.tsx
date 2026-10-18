"use client";

import { useEffect } from "react";
import { observeReadingNavigation } from "@/lib/browser-reading-position";

export function ReadingNavigationObserver() {
  useEffect(observeReadingNavigation, []);
  return null;
}
