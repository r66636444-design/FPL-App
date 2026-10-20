import type { Bootstrap, Entry, Fixture, PicksResponse, Player, Club } from './types';

const ORIGIN = 'https://fantasy.premierleague.com/api';

async function fetchFpl<T>(path: string, revalidate = 300): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${ORIGIN}/${path}`, {
        next: { revalidate },
        headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; FPLIntelligence/1.0)' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`FPL API returned ${response.status} for ${path}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('FPL API is unavailable');
}

export const bootstrap = () => fetchFpl<Bootstrap>('bootstrap-static/', 300);
export const fixtures = () => fetchFpl<Fixture[]>('fixtures/', 300);
export const entry = (id: number) => fetchFpl<Entry>(`entry/${id}/`, 120);
export const picks = (id: number, gw: number) => fetchFpl<PicksResponse>(`entry/${id}/event/${gw}/picks/`, 120);
export const playerHistory = (id: number) => fetchFpl<{history:{round:number;total_points:number;minutes:number}[];fixtures:Fixture[]}>(`element-summary/${id}/`, 600);
export const gameweek = (data: Bootstrap) => data.events.find(e => e.is_next)?.id ?? data.events.find(e => e.is_current)?.id ?? data.events.find(e => !e.finished)?.id ?? data.events.at(-1)?.id ?? 1;
export const latestCompletedGameweek = (data: Bootstrap) => data.events.filter(e => e.finished).at(-1)?.id ?? 0;
export const snapshotGameweek = (data: Bootstrap, manager: Entry) => Math.min(manager.current_event ?? latestCompletedGameweek(data), latestCompletedGameweek(data));
export const cost = (tenths: number) => (tenths / 10).toFixed(1);
export const clubName = (teams: Club[], id: number) => teams.find(t => t.id === id)?.short_name ?? '—';
export const availability = (p: Player) => p.chance_of_playing_next_round == null
  ? (p.status === 'a' ? 1 : p.status === 'd' ? 0.65 : 0.18)
  : Math.max(0, Math.min(1, p.chance_of_playing_next_round / 100));
export const round = (number: number) => Math.round(number * 10) / 10;

export function fixtureWindow(fixtures: Fixture[], teamId: number, fromGameweek: number, length: number): Fixture[] {
  return fixtures.filter(f => f.event !== null && f.event >= fromGameweek && f.event < fromGameweek + length && (f.team_h === teamId || f.team_a === teamId))
    .sort((a, b) => (a.event ?? 0) - (b.event ?? 0) || (a.kickoff_time ?? '').localeCompare(b.kickoff_time ?? ''));
}

/** Official FPL fixture difficulty is a 1–5 opponent grade (1 easiest). */
export function fixtureDifficulty(f: Fixture, teamId: number): number {
  return f.team_h === teamId ? f.team_h_difficulty : f.team_a_difficulty;
}

/** Pure, testable FPL prediction heuristic. NOT a calibrated probabilistic forecast.
 * Base = 65% season points per game + 35% short-term FPL form, then scaled by
 * historical minutes (~60-90min), FPL player availability, and fixture difficulty.
 * All matches in the next N *gameweeks* count: blanks=0, doubles=2.
 */
export function playerProjection(p: Player, matches: Fixture[], clubs: Club[], fromGameweek: number, length = 1) {
  const window = fixtureWindow(matches, p.team, fromGameweek, length);
  const completedWeeks = Math.max(1, fromGameweek - 1);
  const minutesPerWeek = p.minutes / completedWeeks;
  const minutesWeight = Math.max(0.08, Math.min(1, minutesPerWeek / 82));
  const observedSeason = Math.max(0, Number(p.points_per_game) || 0);
  const recentForm = Math.max(0, Number(p.form) || 0);
  const base = (observedSeason * .65 + recentForm * .35) * minutesWeight * availability(p);
  const points = window.reduce((sum, f) => {
    const difficulty = fixtureDifficulty(f, p.team);
    const atHome = f.team_h === p.team;
    const opponent = clubs.find(c => c.id === (atHome ? f.team_a : f.team_h));
    const oppDef = opponent ? (atHome ? opponent.strength_defence_away : opponent.strength_defence_home) : null;
    // FPL strength indexes and official fixture difficulty overlap. Limit both influences.
    const opponentFactor = oppDef && oppDef > 0 ? Math.max(.90, Math.min(1.10, 1120 / oppDef)) : 1;
    const difficultyFactor = 1 + (3 - difficulty) * 0.075;
    return sum + base * opponentFactor * difficultyFactor;
  }, 0);
  return { points: round(points), low: round(points * .60), high: round(points * 1.50), fixtureCount: window.length, minutesPerWeek: round(minutesPerWeek) };
}

export function clubForm(club: Club, matches: Fixture[], limit = 5) {
  const recent = matches.filter(f => f.finished && f.team_h_score !== null && f.team_a_score !== null && (f.team_h === club.id || f.team_a === club.id))
    .sort((a, b) => (b.event ?? 0) - (a.event ?? 0) || (b.kickoff_time ?? '').localeCompare(a.kickoff_time ?? '')).slice(0, limit);
  let goals = 0, conceded = 0, points = 0, cleanSheets = 0;
  for (const f of recent) {
    const home = f.team_h === club.id;
    const scored = (home ? f.team_h_score : f.team_a_score)!;
    const against = (home ? f.team_a_score : f.team_h_score)!;
    goals += scored; conceded += against;
    points += scored > against ? 3 : scored === against ? 1 : 0;
    cleanSheets += against === 0 ? 1 : 0;
  }
  return { played: recent.length, goals, conceded, points, cleanSheets };
}

/** Transparent composite score, not a modelled win probability. */
export function rankClubs(clubs: Club[], matches: Fixture[]) {
  return clubs.map(team => {
    const recent = clubForm(team, matches);
    const strength = Math.min(100, team.strength / 1500 * 100);
    const ppg = recent.played ? recent.points / (recent.played * 3) * 100 : 50;
    const attack = recent.played ? Math.min(100, recent.goals / recent.played / 2.5 * 100) : 50;
    const defence = recent.played ? Math.max(0, 100 - recent.conceded / recent.played * 45) : 50;
    const rating = Math.round(.38 * strength + .32 * ppg + .18 * attack + .12 * defence);
    return { ...team, ...recent, rating, attackRating: round(attack), defenceRating: round(defence) };
  }).sort((a, b) => b.rating - a.rating);
}

export function validSquad(players: Player[]): boolean {
  if (players.length !== 15 || new Set(players.map(p => p.id)).size !== 15) return false;
  const positions = [0, 0, 0, 0, 0];
  const clubCounts = new Map<number, number>();
  for (const p of players) {
    if (p.element_type < 1 || p.element_type > 4) return false;
    positions[p.element_type]++;
    clubCounts.set(p.team, (clubCounts.get(p.team) ?? 0) + 1);
  }
  return positions[1] === 2 && positions[2] === 5 && positions[3] === 5 && positions[4] === 3 && [...clubCounts.values()].every(count => count <= 3);
}

/** Picks the highest estimated legal starting XI from a complete 15-player squad. */
export function optimalXI(players: Player[], matches: Fixture[], clubs: Club[], gw: number) {
  const byPos = new Map<number, { player: Player; points: number }[]>();
  for (const p of players) {
    const items = byPos.get(p.element_type) ?? [];
    items.push({ player: p, points: playerProjection(p, matches, clubs, gw, 1).points });
    byPos.set(p.element_type, items);
  }
  for (const items of byPos.values()) items.sort((a, b) => b.points - a.points);
  if ((byPos.get(1)?.length ?? 0) < 1 || (byPos.get(2)?.length ?? 0) < 3 || (byPos.get(3)?.length ?? 0) < 2 || (byPos.get(4)?.length ?? 0) < 1) return null;
  let best: {starters:Player[]; points:number; formation:string} | null = null;
  for (let defenders = 3; defenders <= 5; defenders++) for (let midfielders = 2; midfielders <= 5; midfielders++) {
    const forwards = 10 - defenders - midfielders;
    if (forwards < 1 || forwards > 3) continue;
    if ([1,2,3,4].some((pos,idx) => (byPos.get(pos)?.length ?? 0) < [1,defenders,midfielders,forwards][idx])) continue;
    const selected = [byPos.get(1)!.slice(0,1),byPos.get(2)!.slice(0,defenders),byPos.get(3)!.slice(0,midfielders),byPos.get(4)!.slice(0,forwards)].flat();
    const points = selected.reduce((sum, x) => sum + x.points, 0);
    if (!best || points > best.points) best = {starters:selected.map(x => x.player),points:round(points),formation:`${defenders}-${midfielders}-${forwards}`};
  }
  if (!best) return null;
  const starters = best.starters;
  const startersIds = new Set(starters.map(p=>p.id));
  const bench = players.filter(p => !startersIds.has(p.id)).sort((a,b) => playerProjection(b,matches,clubs,gw).points-playerProjection(a,matches,clubs,gw).points);
  const captains = [...starters].sort((a,b)=>playerProjection(b,matches,clubs,gw).points-playerProjection(a,matches,clubs,gw).points);
  return { ...best, bench, captain:captains[0], vice:captains[1] };
}

/** Never uses a guessed selling price unless explicitly labelled by the caller. */
export function transferCandidates(out:Player, squad:Player[], pool:Player[], matches:Fixture[], clubs:Club[], gw:number, bankTenths:number, sellingPriceTenths = out.now_cost) {
  const counts = new Map<number,number>();
  for (const player of squad.filter(p=>p.id!==out.id)) counts.set(player.team,(counts.get(player.team)??0)+1);
  const owned = new Set(squad.map(p=>p.id));
  const current = playerProjection(out,matches,clubs,gw,5).points;
  return pool.filter(p => p.element_type === out.element_type && !owned.has(p.id) && p.now_cost <= sellingPriceTenths + bankTenths && (counts.get(p.team)??0) < 3 && p.status !== 'u')
    .map(p=>({...p,predicted:playerProjection(p,matches,clubs,gw,5).points,gain:round(playerProjection(p,matches,clubs,gw,5).points-current)}))
    .sort((a,b)=>b.gain-a.gain).slice(0,12);
}