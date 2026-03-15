import { syncRecent } from './sync-recent.mjs';

const intervalMs = Number(process.env.RECENT_SYNC_INTERVAL || 20000);

async function tick() {
  try {
    await syncRecent();
    console.log(`[live-sync] updated at ${new Date().toLocaleTimeString('zh-TW')}`);
  } catch (error) {
    console.error('[live-sync] update failed:', error.message);
  }
}

await tick();
setInterval(() => {
  void tick();
}, intervalMs);
