import { bootstrap, entry, latestCompletedGameweek, picks } from './fpl';
import type { Bootstrap, Entry, PicksResponse } from './types';

export type PublicTeam = { entry:Entry; selection:PicksResponse|null; snapshotGameweek:number|null; isHistorical:true; updatedAt:string };

/** Only fetches openly published picks. No FPL cookies or password required. */
export async function getPublicTeam(id:number, data?:Bootstrap):Promise<PublicTeam> {
  const [bootstrapData, manager] = await Promise.all([data?Promise.resolve(data):bootstrap(),entry(id)]);
  const finished = latestCompletedGameweek(bootstrapData);
  const current = bootstrapData.events.find(e=>e.is_current)?.id ?? finished;
  // Current GW picks become public once the GW deadline passes. If they aren't
  // published yet, fall back to the last completed GW (never fake a current XI).
  const candidates = [...new Set([current,finished,finished-1].filter(gw=>gw>=1 && gw<=38))];
  let selection:PicksResponse|null=null;
  let snapshotGameweek:number|null=null;
  for (const gw of candidates) {
    try {
      const record=await picks(id,gw);
      if (Array.isArray(record.picks) && record.picks.length===15) { selection=record;snapshotGameweek=gw;break; }
    } catch { /* Not yet public or temporarily unavailable; try an older snapshot. */ }
  }
  return {entry:manager,selection,snapshotGameweek,isHistorical:true,updatedAt:new Date().toISOString()};
}