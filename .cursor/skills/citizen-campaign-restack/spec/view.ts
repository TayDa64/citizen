export const title = "Citizen: campaign restack after an ingest";

function events(n: number) {
  if (n === 0) return "no world events";
  if (n === 1) return "1 world event";
  return `${n} world events`;
}

export const state = (v: any) => {
  const s = events(v.stack.length);
  if (v.phase === "building") return `Rebuilding, ${s}`;
  if (v.reported === "error") return `Restack failed, ${s}`;
  if (v.reported === "ok") return `Restacked, ${s}`;
  return `Playing, ${s}`;
};

export const step = (action: string) => {
  if (action === "ClearFirst") return "an ingest starts rebuilding [after a change]";
  if (action.startsWith("ApplyOne")) return "one event is re-added [while rebuilding]";
  if (action === "Succeed") return "the rebuild finishes";
  if (action === "Fail") return "a step of the rebuild fails";
  if (action === "AdvanceTurn") return "you advance a month";
  if (action === "RerunUnchanged") return "the same ingest runs again [nothing changed]";
  return action;
};
