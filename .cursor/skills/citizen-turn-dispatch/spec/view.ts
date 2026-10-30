export const title = "Citizen: what you see vs what the campaign server holds";

function snap(s: any) {
  const ev = s.events === 1 ? "event on" : "no event";
  return `month ${s.turn}, ${ev}`;
}

export const state = (v: any) => {
  const shown = `Screen ${snap(v.view)}`;
  const server = `server ${snap(v.srv)}`;
  if (v.status === "sending") return `Saving: ${shown}; ${server}`;
  if (v.status === "failed") return `Save failed, Retry shown: ${shown}; ${server}`;
  return `${shown}; ${server}`;
};

export const group = (v: any) =>
  v.status === "failed" ? "failed" : v.status === "sending" ? "saving" : "steady";

export const colors = { steady: "blue", saving: "teal", failed: "yellow" };

export const step = (action: string, from: any, to: any) => {
  if (action === "YouAdvance") return "you advance a month";
  if (action === "CommitOk") return "the server saves a step";
  if (action === "CommitRejected") return "the server rejects a step";
  if (action === "CommitLostReply") return "a step saves but the reply is lost";
  if (action === "NaiveRetry") return "you press Retry";
  if (action === "RefetchThenRetry") return "you press Retry (it re-reads the server)";
  if (action === "Done") return null;
  return action;
};
