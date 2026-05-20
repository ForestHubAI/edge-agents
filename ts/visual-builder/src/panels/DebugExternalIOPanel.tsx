import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Loader2, Play } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NodeCategory, getInput, type NodeInstance, type ExternalInput } from "@foresthub/workflow-core/node";
import type { Schemas } from "@foresthub/workflow-core";
import { getOrCreateCanvasStore } from "../store/canvasStore";
import { useDebugStore, type DebugSessionPhase } from "../store/debugStore";

interface DebugExternalIOPanelProps {
  canvasId: string;
  onStep: (nodeId?: string, externalState?: Schemas["DebugExternalState"]) => void;
  getNodeCategory: (node: NodeInstance) => NodeCategory | undefined;
}

export const DebugExternalIOPanel = ({ canvasId, onStep, getNodeCategory }: DebugExternalIOPanelProps) => {
  const { t } = useTranslation();
  const phase = useDebugStore((s) => s.phase);

  const cursorNodeId = getCursorNodeId(phase);
  const canvasStore = getOrCreateCanvasStore(canvasId);
  const cursorNode = canvasStore((s) =>
    cursorNodeId ? s.nodes.find((n) => n.id === cursorNodeId)?.data ?? null : null,
  );

  const requirements = useMemo(
    () => (cursorNode ? getInput(cursorNode as NodeInstance) : []),
    [cursorNode],
  );

  const isTrigger = cursorNode ? getNodeCategory(cursorNode as NodeInstance) === NodeCategory.Trigger : false;
  const isStepping = phase.status === "stepping";
  const canStep = phase.status === "paused" || (phase.status === "idle" && cursorNodeId);

  // Local state for mock values
  const [gpioValues, setGpioValues] = useState<Record<string, number>>({});
  const [serialValues, setSerialValues] = useState<string[]>([""]);

  const handleStep = useCallback(() => {
    const gpio: Record<string, number> = {};
    const serial: string[] = [];

    for (const req of requirements) {
      if (req.kind === "gpio" && req.pinReference !== undefined) {
        gpio[String(req.pinReference)] = gpioValues[String(req.pinReference)] ?? 0;
      } else if (req.kind === "serial") {
        serial.push(...serialValues.filter((s) => s.length > 0));
      }
    }

    onStep(cursorNodeId ?? undefined, { gpio, serial });
  }, [requirements, gpioValues, serialValues, cursorNodeId, onStep]);

  if (!cursorNodeId) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        {t("builder.debug.selectNode")}
      </div>
    );
  }

  if (isTrigger) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground bg-muted/50 rounded px-3 py-2">
          {t("builder.debug.triggerNotSteppable")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Node label */}
      <div className="text-sm font-medium">
        {(cursorNode as NodeInstance)?.label || (cursorNode as NodeInstance)?.type}
      </div>

      {/* Requirements */}
      {requirements.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {t("builder.debug.noInputsNeeded")}
        </div>
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
            {t("builder.debug.stepping")}
          </>
        ) : (
          <>
            <Play className="w-4 h-4" />
            {t("builder.debug.step")}
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
          {t("builder.debug.gpioPin", { pin: requirement.pinReference ?? "?" })}
          <span className="text-muted-foreground ml-1">({requirement.dataType})</span>
        </Label>
        {requirement.dataType === "bool" ? (
          <Switch
            checked={!!value}
            onCheckedChange={(checked) =>
              setGpioValues((prev) => ({ ...prev, [pinKey]: checked ? 1 : 0 }))
            }
          />
        ) : (
          <Input
            type="number"
            value={value}
            onChange={(e) =>
              setGpioValues((prev) => ({ ...prev, [pinKey]: parseInt(e.target.value) || 0 }))
            }
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
      <Label className="text-xs font-medium">{t("builder.debug.serialInput")}</Label>
      <Input
        value={serialValues[serialIndex] ?? ""}
        onChange={(e) => {
          setSerialValues((prev) => {
            const next = [...prev];
            next[serialIndex] = e.target.value;
            return next;
          });
        }}
        placeholder={t("builder.debug.serialPlaceholder")}
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
