import type { ReactNode } from "react";

type DataTableProps = {
  columns: string[];
  children: ReactNode;
  minWidth?: string;
};

export function DataTable({ columns, children, minWidth = "min-w-[720px]" }: DataTableProps) {
  return (
    <div className="app-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-left text-sm ${minWidth}`}>
          <thead className="border-b border-app-border bg-app-elevated/80 text-[11px] uppercase tracking-[0.09em] text-app-subtle">
            <tr>
              {columns.map((column) => (
                <th key={column} className="whitespace-nowrap px-5 py-3.5 font-bold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border [&_td]:px-5 [&_td]:py-4 [&_td]:align-middle [&_tr]:transition-colors [&_tr:hover]:bg-app-elevated/65">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}
