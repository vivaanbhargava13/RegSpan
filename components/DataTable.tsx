import type { ReactNode } from "react";

type DataTableProps = {
  columns: string[];
  children: ReactNode;
  minWidth?: string;
};

export function DataTable({ columns, children, minWidth = "min-w-[720px]" }: DataTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-left text-sm ${minWidth}`}>
          <thead className="bg-canvas text-xs uppercase tracking-normal text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </div>
  );
}
