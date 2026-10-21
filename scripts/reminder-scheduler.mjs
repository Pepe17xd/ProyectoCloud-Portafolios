import { runDueReminders } from '../services/identity-service/orbital.mjs';

const interval = Math.max(5, Number(process.env.REMINDER_POLL_SECONDS) || 15) * 1000;
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
console.log(JSON.stringify({ level: 'info', service: 'reminder-scheduler', mode: 'SIMULATED_LOCAL_NOT_SENT', intervalMs: interval }));
while (running) {
  try {
    const results = await runDueReminders();
    for (const result of results) console.log(JSON.stringify({ level: 'info', service: 'reminder-scheduler', ...result }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', service: 'reminder-scheduler', message: error.message }));
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
