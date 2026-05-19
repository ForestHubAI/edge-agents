import * as React from "react"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "./table"
import { Checkbox } from "./checkbox"
import { Button } from "./button"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "../../lib/utils"
import { InlineEmptyState } from "./empty-state"
import { TableSkeleton } from "./skeleton-layouts"

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  render?: (item: T) => React.ReactNode
  className?: string
}

export interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  onSort?: (key: string, direction: "asc" | "desc") => void
  sortKey?: string
  sortDirection?: "asc" | "desc"
  selectable?: boolean
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  getRowId: (item: T) => string
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  className?: string
}

/**
 * DataTable Component
 * 
 * Feature-rich table with sorting, selection, loading states, and empty states.
 * 
 * @example
 * <DataTable
 *   data={projects}
 *   columns={[
 *     { key: 'name', header: 'Name', sortable: true },
 *     { key: 'status', header: 'Status', render: (item) => <Badge>{item.status}</Badge> },
 *     { key: 'actions', header: 'Actions', render: (item) => <Button>Edit</Button> },
 *   ]}
 *   getRowId={(item) => item.id}
 *   onSort={handleSort}
 *   selectable
 *   selectedIds={selectedIds}
 *   onSelectionChange={setSelectedIds}
 *   loading={loading}
 *   emptyTitle="No projects"
 *   emptyDescription="Create your first project"
 *   emptyAction={<Button>Create</Button>}
 * />
 */
export function DataTable<T>({
  data,
  columns,
  onSort,
  sortKey,
  sortDirection,
  selectable,
  selectedIds = new Set(),
  onSelectionChange,
  getRowId,
  loading,
  emptyTitle = "No data",
  emptyDescription,
  emptyAction,
  className,
}: DataTableProps<T>) {
  const allSelected = data.length > 0 && data.every(item => selectedIds.has(getRowId(item)))
  const someSelected = data.some(item => selectedIds.has(getRowId(item))) && !allSelected

  const handleSelectAll = () => {
    if (!onSelectionChange) return
    
    if (allSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(data.map(getRowId)))
    }
  }

  const handleSelectRow = (id: string) => {
    if (!onSelectionChange) return
    
    const newSelection = new Set(selectedIds)
    if (newSelection.has(id)) {
      newSelection.delete(id)
    } else {
      newSelection.add(id)
    }
    onSelectionChange(newSelection)
  }

  const handleSort = (key: string) => {
    if (!onSort) return
    
    if (sortKey === key) {
      onSort(key, sortDirection === "asc" ? "desc" : "asc")
    } else {
      onSort(key, "asc")
    }
  }

  if (loading) {
    return <TableSkeleton rows={5} columns={columns.length + (selectable ? 1 : 0)} />
  }

  if (data.length === 0) {
    return (
      <InlineEmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    )
  }

  return (
    <div className={cn("rounded-md border", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                  className={someSelected ? "opacity-50" : ""}
                />
              </TableHead>
            )}
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.sortable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort(column.key)}
                    className="-ml-3 h-8 data-[state=open]:bg-accent"
                  >
                    {column.header}
                    {sortKey === column.key ? (
                      sortDirection === "asc" ? (
                        <ArrowUp className="ml-2 h-4 w-4" />
                      ) : (
                        <ArrowDown className="ml-2 h-4 w-4" />
                      )
                    ) : (
                      <ArrowUpDown className="ml-2 h-4 w-4 opacity-50" />
                    )}
                  </Button>
                ) : (
                  column.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => {
            const id = getRowId(item)
            const isSelected = selectedIds.has(id)

            return (
              <TableRow 
                key={id}
                data-state={isSelected ? "selected" : undefined}
                className={cn(
                  isSelected && "bg-muted/50",
                  "transition-colors hover:bg-muted/50"
                )}
              >
                {selectable && (
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleSelectRow(id)}
                      aria-label={`Select row ${id}`}
                    />
                  </TableCell>
                )}
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.render 
                      ? column.render(item) 
                      : String((item as Record<string, unknown>)[column.key] ?? '')}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
