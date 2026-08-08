"use client";

import Panel from "./panel";
import { money } from "@/lib/format";

/**
 * The session log.
 *
 * **This is a session counter, not a ledger**, and the footer says so in the
 * product's own words. It lives in one browser tab, it dies with the process,
 * and it is not reconciliation — `GET /api/treasury` is the record. Rendering
 * it as a table with a running total would make it look like books, and PRD §14
 * bars this console from keeping any.
 *
 * Numbers are tabular so the columns do not jitter as rows arrive: a latency
 * column that reflows every request is a column nobody can read at a glance.
 */

export interface LogRow {
  at: string;
  method: string;
  path: string;
  status: number | string;
  settled: boolean;
  amountCents: number | null;
  ms: number | null;
}

export default function ResponseLog({ rows }: { rows: LogRow[] }) {
  return (
    <Panel icon="scroll-text" title="Response log" className="pane-log">
      {rows.length === 0 ? (
        <div className="pane-body empty small">
          <p className="muted">Nothing run yet this sitting.</p>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="log-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Method</th>
                  <th scope="col">Path</th>
                  <th scope="col" className="right">
                    Status
                  </th>
                  <th scope="col">Settled</th>
                  <th scope="col" className="right">
                    Amount
                  </th>
                  <th scope="col" className="right">
                    Latency
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.at}-${i}`}>
                    <td className="num">{row.at}</td>
                    <td>
                      <span className="method" data-method={row.method}>
                        {row.method}
                      </span>
                    </td>
                    <td className="ellipsis path" title={row.path}>
                      {row.path}
                    </td>
                    <td className="num right" data-tone={Number(row.status) < 300 ? "ok" : "bad"}>
                      {row.status}
                    </td>
                    <td data-tone={row.settled ? "ember" : "muted"}>
                      {row.settled ? "true" : "false"}
                    </td>
                    <td className="num right">
                      {row.amountCents === null ? "—" : money(row.amountCents)}
                    </td>
                    <td className="num right">{row.ms === null ? "—" : `${row.ms} ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-foot">
            {rows.length} this sitting. A session counter, not a ledger —{" "}
            <code>GET /api/treasury</code> is the record.
          </p>
        </>
      )}
    </Panel>
  );
}
