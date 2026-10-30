export const title = "Citizen: campaign restack after an ingest (atomic, locked)";

function events(n: number) {
  if (n === 0) return "no world events";
  if (n === 1) return "1 world event";
  return `${n} world events`;
}

function count(v: any, status: string) {
  return Object.values(v.pc).filter((s) => s === status).length;
}

export const state = (v: any) => {
  const s = events(v.stack.length);
  const pending = count(v, "persisted");
  if (pending === 2) return `2 ingests waiting to rebuild, ${s}`;
  if (pending === 1) return `1 ingest waiting to rebuild, ${s}`;
  if (count(v, "error") > 0) return `Restack failed, ${s}`;
  if (count(v, "ok") > 0) return `Restacked, ${s}`;
  return `Playing, ${s}`;
};

export const step = (action: string) => {
  if (action.startsWith("Persist")) return "an ingest stores changed triggers";
  if (action.startsWith("Rebuild")) return "an ingest rebuilds the stack in one commit";
  if (action.startsWith("Fail")) return "an ingest's rebuild fails and rolls back";
  if (action === "AdvanceTurn") return "you advance a month";
  if (action === "Done") return null;
  return action;
};
