import { Suspense } from "react";

import { formatUsd } from "@/ai/cost";
import { getUsageStats } from "@/server/stats/service";

export default function StatsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <Stats />
      </Suspense>
    </div>
  );
}

async function Stats() {
  const stats = await getUsageStats();
  const maxDailyCost = Math.max(1, ...stats.byDay.map((day) => day.costNanoUsd));

  return (
    <div className="space-y-10">
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Spent, last 24h" value={formatUsd(stats.lastDay.costNanoUsd)} />
        <Tile
          label="Billed calls, 24h"
          value={String(stats.lastDay.calls)}
          hint={`${stats.lastDay.modelCalls} to Claude · ${stats.lastDay.embeddingCalls} embeddings`}
        />
        <Tile
          label="Avg per generation"
          value={formatUsd(stats.allTime.costPerGenerationNanoUsd)}
          hint={`${stats.allTime.completedGenerations} completed`}
        />
        <Tile
          label="Saved by cache"
          value={formatUsd(stats.allTime.savedNanoUsd)}
          hint={`${stats.allTime.cacheHits} hits · estimated`}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Last 14 days</h2>
        <ul className="space-y-1">
          {stats.byDay.map((day) => (
            <li key={day.day.toISOString()} className="flex items-center gap-3 text-xs">
              <span className="w-20 shrink-0 text-zinc-500">
                {day.day.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </span>
              <span className="w-14 shrink-0 text-right tabular-nums">{day.calls}</span>
              <span className="w-20 shrink-0 text-right tabular-nums">
                {formatUsd(day.costNanoUsd)}
              </span>
              <span
                className="h-2 rounded-sm bg-zinc-300 dark:bg-zinc-700"
                style={{ width: `${(day.costNanoUsd / maxDailyCost) * 100}%` }}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">By model</h2>
        <table className="w-full text-xs">
          <thead className="text-zinc-500">
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 font-medium">Model</th>
              <th className="py-2 text-right font-medium">Calls</th>
              <th className="py-2 text-right font-medium">Input</th>
              <th className="py-2 text-right font-medium">Output</th>
              <th className="py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {stats.byModel.map((row) => (
              <tr key={row.model} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 font-mono">{row.model}</td>
                <td className="py-2 text-right tabular-nums">{row.calls}</td>
                <td className="py-2 text-right tabular-nums">{row.inputTokens.toLocaleString("en-GB")}</td>
                <td className="py-2 text-right tabular-nums">{row.outputTokens.toLocaleString("en-GB")}</td>
                <td className="py-2 text-right tabular-nums">{formatUsd(row.costNanoUsd)}</td>
              </tr>
            ))}
            {stats.byModel.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-3 text-zinc-500">
                  No billed calls yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Failed and retried attempts, last 24h
        </h2>
        {stats.failures.length === 0 ? (
          <p className="text-xs text-zinc-500">None.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {stats.failures.map((failure) => (
              <li key={failure.code} className="flex gap-3">
                <span className="w-32 font-mono">{failure.code}</span>
                <span className="tabular-nums">{failure.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="space-y-1 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}
