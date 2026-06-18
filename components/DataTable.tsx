import type { ReactNode } from "react";

type DataTableProps = {
  columns: string[];
  children: ReactNode;
  minWidth?: string;
};

export function DataTable({ columns, children, minWidth = "min-w-[720px]" }: DataTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-app-soft">
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-left text-sm ${minWidth}`}>
          <thead className="bg-app-elevated text-xs uppercase tracking-normal text-app-subtle">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border [&_tr:hover]:bg-app-elevated">{children}</tbody>
        </table>
      </div>
    </div>
  );
}
