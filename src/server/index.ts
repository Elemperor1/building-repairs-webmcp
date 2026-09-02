import { createApp } from "./app.js";
import { isControlledLiveMode } from "./controlled-live.js";
import { liveRepairAgent } from "./repair-agent.js";

const port = Number(process.env.PORT ?? 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`Repair API listening on http://localhost:${port}`);
  if (isControlledLiveMode()) liveRepairAgent.resume();
});
