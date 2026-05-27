import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Loader2, Play } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NodeCategory, getInput, type NodeData, type ExternalInput } from "@foresthubai/workflow-core/node";
import { getOrCreateCanvasStore } from "../stores/canvasStore";
import { useDebugStore, type DebugSessionPhase } from "../stores/debugStore";

interface DebugExternalIOPanelProps {
  canvasId: string;
  onStep: (nodeId?: string) => void;
  getNodeCategory: (node: NodeData) => NodeCategory | undefined;
}

export const DebugExternalIOPanel = ({ canvasId, onStep, getNodeCategory }: DebugExternalIOPanelProps) => {
  const { t } = useTranslation();
  const phase = useDebugStore((s) => s.phase);

  const cursorNodeId = getCursorNodeId(phase);
  const canvasStore = getOrCreateCanvasStore(canvasId);
  const cursorNode = canvasStore((s) =>
    cursorNodeId ? (s.nodes.find((n) => n.id === cursorNodeId)?.data ?? null) : null,
  );

  const requirements = useMemo(() => (cursorNode ? getInput(cursorNode as NodeData) : []), [cursorNode]);

  const isTrigger = cursorNode ? getNodeCategory(cursorNode as NodeData) === NodeCategory.Trigger : false;
  const isStepping = phase.status === "stepping";
  const canStep = phase.status === "paused" || (phase.status === "idle" && cursorNodeId);

  // Local state for mock values
  const [gpioValues, setGpioValues] = useState<Record<string, number>>({});
  const [serialValues, setSerialValues] = useState<string[]>([""]);

  const handleStep = useCallback(() => {
    // External-state injection (gpio/serial) is part of the not-yet-implemented
    // debug contract (DebugExternalState). For now we only signal which node to
    // step; the collected input values below are not yet wired to the engine.
    onStep(cursorNodeId ?? undefined);
  }, [cursorNodeId, onStep]);

  if (!cursorNodeId) {
    return <div className="text-sm text-muted-foreground text-center py-4">{t("debug.selectNode")}</div>;
  }

  if (isTrigger) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground bg-muted/50 rounded px-3 py-2">
          {t("debug.triggerNotSteppable")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Node label */}
      <div className="text-sm font-medium">
        {(cursorNode as NodeData)?.label || (cursorNode as NodeData)?.type}
      </div>

      {/* Requirements */}
      {requirements.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("debug.noInputsNeeded")}</div>
      ) : (
        <div className="space-y-3">
          {requirements.map((req, i) => (
            <ExternalInputField
              key={i}
              requirement={req}
              gpioValues={gpioValues}
              setGpioValues={setGpioValues}
              serialValues={serialValues}
              setSerialValues={setSerialValues}
              serialIndex={requirements.slice(0, i).filter((r) => r.kind === "serial").length}
            />
          ))}
        </div>
      )}

      {/* Step button */}
      <Button className="w-full gap-2" onClick={handleStep} disabled={!canStep || isStepping}>
        {isStepping ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {t("debug.stepping")}
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t("debug.step")}
          </>
        )}
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ExternalInputField({
  requirement,
  gpioValues,
  setGpioValues,
  serialValues,
  setSerialValues,
  serialIndex,
}: {
  requirement: ExternalInput;
  gpioValues: Record<string, number>;
  setGpioValues: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  serialValues: string[];
  setSerialValues: React.Dispatch<React.SetStateAction<string[]>>;
  serialIndex: number;
}) {
  const { t } = useTranslation();

  if (requirement.kind === "gpio") {
    const pinKey = String(requirement.pinReference ?? "?");
    const value = gpioValues[pinKey] ?? 0;

    return (
      <div className="space-y-1">
        <Label className="text-xs font-medium">
          {t("debug.gpioPin", { pin: requirement.pinReference ?? "?" })}
          <span className="text-muted-foreground ml-1">({requirement.dataType})</span>
        </Label>
        {requirement.dataType === "bool" ? (
          <Switch
            checked={!!value}
            onCheckedChange={(checked) => setGpioValues((prev) => ({ ...prev, [pinKey]: checked ? 1 : 0 }))}
          />
        ) : (
          <Input
            type="number"
            value={value}
            onChange={(e) => setGpioValues((prev) => ({ ...prev, [pinKey]: parseInt(e.target.value) || 0 }))}
            className="h-8 font-mono text-sm"
            min={0}
            max={4095}
          />
        )}
      </div>
    );
  }

  // Serial input
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{t("debug.serialInput")}</Label>
      <Input
        value={serialValues[serialIndex] ?? ""}
        onChange={(e) => {
          setSerialValues((prev) => {
            const next = [...prev];
            next[serialIndex] = e.target.value;
            return next;
          });
        }}
        placeholder={t("debug.serialPlaceholder")}
        className="h-8 font-mono text-sm"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCursorNodeId(phase: DebugSessionPhase): string | null {
  if (phase.status === "paused" || phase.status === "stepping") return phase.cursorNodeId;
  return null;
}
