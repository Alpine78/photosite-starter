"use client";

import { useId, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import type { TabGroupBlock } from "@/lib/content-tab-group";
import type { BuiltInLabels } from "@/lib/deployment-config";

const subscribeToNothing = () => () => {};

type TabTable = TabGroupBlock["tabs"][number]["table"];

function TableRegion({ table, label }: { table: TabTable; label: string }) {
  return (
    <div
      role="region"
      aria-label={table.caption ?? label}
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table className="w-full border-collapse text-left text-sm">
        {table.caption !== undefined && (
          <caption className="mb-2 text-left text-sm text-muted">{table.caption}</caption>
        )}
        <thead>
          <tr>
            {table.headers.map((header, column) => (
              <th
                key={column}
                scope="col"
                className="border-b border-border-strong px-3 py-2 font-semibold whitespace-nowrap text-foreground"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, column) => (
                <td key={column} className="border-b border-border-control px-3 py-2 align-top text-body">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ContentTabGroupProps = {
  block: TabGroupBlock;
  labels: BuiltInLabels["tabGroup"];
  /** Fallback region name for a tab's table when it has no own caption — the same fallback the standalone table block uses. */
  tableLabel: string;
};

/**
 * A bounded set of named tabs, each holding one data table (AB#163,
 * ADR-0020). Scoped to exactly what the legacy Bootstrap `nav-tabs`/
 * `tab-content` pattern that motivated it carried — a tab is not a generic
 * rich sub-body.
 *
 * Without JavaScript every tab's table renders, stacked in authored order
 * and individually labelled, rather than an inactive control hiding all but
 * one panel (matching `ContentImageComparison`'s own no-controls-without-JS
 * posture). Once hydrated this becomes the WAI-ARIA Tabs pattern —
 * `tablist`/`tab`/`tabpanel` roles, one active tab, automatic activation on
 * arrow-key navigation with a roving `tabIndex`, and visible focus.
 */
export function ContentTabGroup({ block, labels, tableLabel }: ContentTabGroupProps) {
  const id = useId();
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [activeIndex, setActiveIndex] = useState(0);

  const tabId = (index: number) => `${id}-tab-${index}`;
  const panelId = (index: number) => `${id}-panel-${index}`;

  function activate(index: number) {
    setActiveIndex(index);
    document.getElementById(tabId(index))?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = block.tabs.length;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      activate((index + 1) % count);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      activate((index - 1 + count) % count);
    } else if (event.key === "Home") {
      event.preventDefault();
      activate(0);
    } else if (event.key === "End") {
      event.preventDefault();
      activate(count - 1);
    }
  }

  if (!hydrated) {
    return (
      <div className="space-y-6">
        {block.tabs.map((tab, index) => (
          <div key={tab.key ?? index} className="space-y-2">
            <p className="font-semibold text-foreground">{tab.label}</p>
            <TableRegion table={tab.table} label={tableLabel} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={labels.label} className="flex flex-wrap gap-2 border-b border-border-control">
        {block.tabs.map((tab, index) => (
          <button
            key={tab.key ?? index}
            type="button"
            id={tabId(index)}
            role="tab"
            aria-selected={index === activeIndex}
            aria-controls={panelId(index)}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => activate(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`min-h-11 rounded-t-md border border-b-0 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
              index === activeIndex
                ? "border-border-control bg-surface font-semibold text-foreground"
                : "border-transparent text-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {block.tabs.map((tab, index) => (
        <div key={tab.key ?? index} id={panelId(index)} role="tabpanel" aria-labelledby={tabId(index)} hidden={index !== activeIndex}>
          <TableRegion table={tab.table} label={tableLabel} />
        </div>
      ))}
    </div>
  );
}
