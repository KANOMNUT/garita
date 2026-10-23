import { memo } from "react";
import { Wifi, Square } from "lucide-react";
import { usePortForwards, useStopPortForward } from "../hooks/useResources";

export const PortForwardBar = memo(function PortForwardBar() {
  const { data: forwards = [] } = usePortForwards();
  const stopForward = useStopPortForward();

  if (forwards.length === 0) return null;

  return (
    <div className="h-8 border-t border-edge bg-panel/90 flex items-center px-3 gap-2 shrink-0">
      <Wifi size={11} className="text-ok shrink-0" />
      <span className="text-[10.5px] text-dim mono">Port Forwards:</span>
      <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0">
        {forwards.map((f) => (
          <div key={f.id} className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-ok/10 ring-1 ring-ok/20 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            <span className="mono text-[10.5px] text-ok">
              {f.name}:{f.pod_port} → :{f.local_port}
            </span>
            <button
              onClick={() => stopForward.mutate({ forwardId: f.id })}
              className="h-4 w-4 flex items-center justify-center rounded-sm text-ok/60 hover:text-bad transition-colors"
              title="Stop"
            >
              <Square size={9} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
