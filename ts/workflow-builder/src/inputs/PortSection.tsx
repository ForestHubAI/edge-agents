// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { AddButton } from "../components/ui/add-button";
import { Trash2 } from "lucide-react";
import type { DataType } from "@foresthubai/workflow-core";

const DATA_TYPES: DataType[] = ["int", "float", "bool", "string"];

/** The editable bits of a function port: a name and a data type, keyed by uid. */
export interface Port {
  uid: string;
  name: string;
  dataType: DataType;
}

/**
 * One declaration row, styled like the node Outputs rows (a `bg-card` shadow card):
 * a header with name + dataType + remove, plus an optional body (e.g. the return
 * expression editor for outputs).
 */
function PortRow({
  port,
  onUpdate,
  onRemove,
  errors,
  children,
}: {
  port: Port;
  onUpdate: (patch: { name?: string; dataType?: DataType }) => void;
  onRemove: () => void;
  errors?: string[];
  children?: ReactNode;
}) {
  const hasError = !!errors?.length;
  return (
    <div
      className={`rounded-lg bg-card shadow-sm border p-2 space-y-2 transition-all hover:shadow-md ${
        hasError ? "border-destructive ring-1 ring-destructive" : "border-border"
      }`}
    >
      <div className="flex items-center gap-2">
        <Input
          className="h-7 text-xs flex-1"
          value={port.name}
          placeholder={"name"}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
        <Select value={port.dataType} onValueChange={(dt: DataType) => onUpdate({ dataType: dt })}>
          <SelectTrigger className="h-7 text-xs w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATA_TYPES.map((dt) => (
              <SelectItem key={dt} value={dt} className="text-xs">
                {dt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      {children}
      {hasError && (
        <div className="space-y-0.5">
          {errors!.map((msg, i) => (
            <p key={i} className="text-xs text-destructive">
              {msg}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A titled section of function ports — a strong label + description (the shared
 * panel field pattern), a card per port, and an Add button. Used for both inputs
 * and outputs; outputs supply the return-expression editor via `renderExtra`.
 */
export function PortSection<P extends Port>({
  title,
  description,
  addLabel,
  emptyText,
  ports,
  onAdd,
  onUpdate,
  onRemove,
  errorsFor,
  renderExtra,
}: {
  title: string;
  description: string;
  addLabel: string;
  emptyText: string;
  ports: readonly P[];
  onAdd: () => void;
  onUpdate: (index: number, patch: { name?: string; dataType?: DataType }) => void;
  onRemove: (index: number) => void;
  /** Per-port error messages — rings the row red and lists them (e.g. a missing or
   *  invalid return expression on that output). */
  errorsFor?: (port: P) => string[];
  renderExtra?: (port: P, index: number) => ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {ports.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {ports.map((port, index) => (
            <PortRow
              key={port.uid}
              port={port}
              onUpdate={(patch) => onUpdate(index, patch)}
              onRemove={() => onRemove(index)}
              errors={errorsFor?.(port)}
            >
              {renderExtra?.(port, index)}
            </PortRow>
          ))}
        </div>
      )}

      <AddButton onClick={onAdd}>{addLabel}</AddButton>
    </div>
  );
}
