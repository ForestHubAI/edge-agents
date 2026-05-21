import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataType, Expression, Reference, NodeRegistry } from "@foresthub/workflow-core/node";
import { ResolvedExpr, resolveExpression } from "@foresthub/workflow-core/expression";
import { varKey, type Variable } from "@foresthub/workflow-core/variable";
import { useEditorStore } from "../stores/editorStore";
import { getOrCreateCanvasStore } from "../stores/canvasStore";
import { cn } from "../lib/utils";

interface ExpressionInputProps {
  value: Expression;
  onChange: (value: Expression) => void;
  expressionType: DataType;
  availableVariables: Record<string, Variable>;
  placeholder?: string;
}

const ExpressionInput = ({
  value: apiValue,
  onChange,
  expressionType,
  availableVariables,
  placeholder,
}: ExpressionInputProps) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? "${var1}";
  // Convert to resolved expression for internal use
  const value = useMemo((): ResolvedExpr => {
    return resolveExpression(apiValue, availableVariables);
  }, [apiValue, availableVariables]);

  // Convert Record to array for iteration
  const variableList = useMemo(() => Object.values(availableVariables), [availableVariables]);

  const [inputValue, setInputValue] = useState(value?.expression ?? "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState(0);
  const [filterText, setFilterText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(false);

  // Filter variables based on what user typed after $
  const filteredVariables = useMemo(
    () => variableList.filter((v) => v.name.toLowerCase().includes(filterText.toLowerCase())),
    [variableList, filterText],
  );

  // nodeId → user-facing display name for the active canvas, used to label
  // node-output variables in the dropdown. Falls back to the node definition's
  // human label, never the schema-internal `type`. Resolved lazily when the
  // dropdown opens (labels can't change while it's open) so typing in an
  // expression doesn't subscribe this input to every node mutation.
  const activeCanvasId = useEditorStore((s) => s.activeCanvasId);
  const nodeLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    if (!showDropdown) return map;
    for (const n of getOrCreateCanvasStore(activeCanvasId).getState().nodes) {
      map[n.id] = n.data.label ?? NodeRegistry.getByType(n.data.type)?.label ?? n.data.type;
    }
    return map;
  }, [showDropdown, activeCanvasId]);

  // Find a variable by name from variableList
  const findVariableByName = useCallback(
    (name: string): Variable | undefined => {
      return variableList.find((v) => v.name === name);
    },
    [variableList],
  );

  // Parse display expression to API expression format
  // Converts ${name} syntax to ${} placeholders with references array
  const parseToApiExpression = useCallback(
    (displayExpr: string): Expression => {
      const references: Reference[] = [];
      const regex = /\$\{([^}]+)\}/g;
      let match;
      let expressionWithPlaceholders = displayExpr;

      // First pass: collect all variable names and their positions
      const matches: { name: string; start: number; end: number }[] = [];
      while ((match = regex.exec(displayExpr)) !== null) {
        matches.push({ name: match[1] ?? "", start: match.index, end: match.index + match[0].length });
      }

      // Build expression with empty placeholders and collect references
      let offset = 0;
      for (const m of matches) {
        const availableVar = findVariableByName(m.name);
        if (availableVar) {
          if (availableVar.kind === "node") {
            references.push({ srcId: availableVar.nodeId, varId: availableVar.outputId });
          } else if (availableVar.kind === "fnarg") {
            references.push({ srcId: "fnarg", varId: availableVar.uid });
          } else {
            references.push({ srcId: "declared", varId: availableVar.uid });
          }
        } else {
          // Variable not found - use invalid reference
          references.push({ srcId: "", varId: "" });
        }
        // Replace ${name} with ${}
        const before = expressionWithPlaceholders.slice(0, m.start + offset);
        const after = expressionWithPlaceholders.slice(m.end + offset);
        expressionWithPlaceholders = before + "${}" + after;
        // Adjust offset: original was ${name} (3 + name.length), new is ${} (3)
        offset -= m.name.length;
      }

      return { expression: expressionWithPlaceholders, references, dataType: expressionType };
    },
    [findVariableByName, expressionType],
  );

  // Resolve expression display by filling ${} placeholders with variable names
  const resolveExpressionDisplay = useCallback((expr: ResolvedExpr | undefined): string => {
    if (!expr) return "";

    let result = expr.expression;
    let varIndex = 0;

    // Replace each ${} with the corresponding variable's name
    result = result.replace(/\$\{\}/g, () => {
      if (varIndex < expr.variables.length) {
        const variable = expr.variables[varIndex];
        varIndex++;
        const name = variable?.name ?? "unknown";
        return `\${${name}}`;
      }
      return "${}"; // No variable for this placeholder
    });

    return result;
  }, []);

  // Only sync from external value when NOT actively editing
  useEffect(() => {
    if (isEditingRef.current) return;
    const resolved = resolveExpressionDisplay(value);
    if (resolved !== inputValue) {
      setInputValue(resolved);
    }
  }, [value, resolveExpressionDisplay, inputValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isEditingRef.current = true;
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart ?? 0;
    setInputValue(newValue);

    // Check if user just typed $ or is mid-variable reference
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const dollarIndex = textBeforeCursor.lastIndexOf("$");

    if (dollarIndex !== -1) {
      const textAfterDollar = textBeforeCursor.slice(dollarIndex + 1);
      // Skip if this $ is part of an already-closed ${...} reference
      const isClosedRef = textAfterDollar.startsWith("{") && textAfterDollar.includes("}");
      if (
        !isClosedRef &&
        (textAfterDollar === "" || textAfterDollar.startsWith("{") || /^[a-zA-Z_]/.test(textAfterDollar))
      ) {
        const filter = textAfterDollar.replace(/^\{?/, "");
        setFilterText(filter);
        setDropdownPosition(dollarIndex);
        setShowDropdown(true);
        setSelectedIndex(0);
        return;
      }
    }

    setShowDropdown(false);
    onChange(parseToApiExpression(newValue));
  };

  // Handle blur - mark editing as finished and commit final value
  const handleBlur = () => {
    isEditingRef.current = false;
    onChange(parseToApiExpression(inputValue));
  };

  const selectVariable = (variable: Variable) => {
    const beforeDollar = inputValue.slice(0, dropdownPosition);
    const afterCursor = inputValue.slice(inputRef.current?.selectionStart ?? inputValue.length);

    // Remove any partial variable name after $
    const cleanAfter = afterCursor.replace(/^[{]?[a-zA-Z_]*[}]?/, "");

    const newValue = `${beforeDollar}\${${variable.name}}${cleanAfter}`;
    setInputValue(newValue);
    setShowDropdown(false);
    onChange(parseToApiExpression(newValue));

    // Focus back to input
    setTimeout(() => {
      inputRef.current?.focus();
      const newCursorPos = beforeDollar.length + variable.name.length + 3;
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Handle keyboard navigation in dropdown
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredVariables.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
      case "Tab":
        e.preventDefault();
        if (filteredVariables[selectedIndex]) {
          selectVariable(filteredVariables[selectedIndex]);
        }
        break;
      case "Escape":
        setShowDropdown(false);
        break;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getTypeColor = (dataType: DataType) => {
    switch (dataType) {
      case "int":
        return "text-type-int";
      case "float":
        return "text-type-float";
      case "bool":
        return "text-type-bool";
      case "string":
        return "text-type-string";
      default:
        return "text-type-any";
    }
  };

  return (
    <div ref={containerRef}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={resolvedPlaceholder}
          className="w-full h-9 px-3 py-1 text-sm bg-field border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring font-mono"
        />

        {/* Variable dropdown */}
        {showDropdown && filteredVariables.length > 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-auto">
            {filteredVariables.map((variable, index) => (
              <button
                key={varKey(variable)}
                onClick={() => selectVariable(variable)}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-accent",
                  index === selectedIndex && "bg-accent",
                )}
              >
                <div className="flex flex-col">
                  <span className="font-mono">
                    ${"{"}
                    {variable.name}
                    {"}"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">
                    {variable.kind === "node"
                      ? t("fromNode", { node: nodeLabelById[variable.nodeId] ?? variable.nodeId })
                      : variable.kind === "declared"
                        ? t("globalVariable")
                        : t("fnarg")}
                  </span>
                </div>
                <span className={cn("text-xs", getTypeColor(variable.dataType))}>{variable.dataType}</span>
              </button>
            ))}
          </div>
        )}

        {/* Type indicator */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          <span className="text-xs text-muted-foreground">→ {expressionType}</span>
        </div>
      </div>
    </div>
  );
};

export default ExpressionInput;
