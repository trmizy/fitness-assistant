import { classifyGlobal } from "../../backend/services/ai-service/src/conversational-intelligence/global/router";
for (const t of process.argv.slice(2)) console.log(JSON.stringify(classifyGlobal(t, {})), "\n  ←", t);
