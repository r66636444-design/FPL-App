import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { bootstrap, fixtures, gameweek, playerProjection, rankClubs, transferCandidates, clubName, optimalXI, fixtureWindow, fixtureDifficulty, round } from '@/lib/fpl';
import { getPublicTeam } from '@/lib/team';
import { getNews } from '@/lib/news';
import type { Player } from '@/lib/types';

const schema=z.object({question:z.string().trim().min(2).max(1200),teamId:z.number().int().min(1).max(999999999).nullable().optional()});
const baseRef={label:'Official FPL data',url:'https://fantasy.premierleague.com/'};
// Basic best-effort instance-local protection. Use an external store for horizontal scaling.
const hits=new Map<string,{count:number;since:number}>();
function throttled(ip:string){const now=Date.now();if(hits.size>2000)hits.clear();const state=hits.get(ip);if(!state||now-state.since>60000){hits.set(ip,{count:1,since:now});return false;}state.count++;return state.count>15;}

export async function POST(request:NextRequest){
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  if(throttled(ip))return NextResponse.json({error:'Too many requests. Please try again shortly.'},{status:429});
  let input:z.infer<typeof schema>;
  try{const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:'Please enter a valid question and team ID.'},{status:400});input=parsed.data;}
  catch{return NextResponse.json({error:'Invalid request body.'},{status:400});}
  try {
    const [data,matches]=await Promise.all([bootstrap(),fixtures()]);
    const gw=gameweek(data);
    const manager=input.teamId?await getPublicTeam(input.teamId,data).catch(()=>null):null;
    const picks=manager?.selection?.picks??[];
    const squad=picks.map(p=>data.elements.find(y=>y.id===p.element)).filter((p):p is Player=>!!p);
    const xi=squad.length===15?optimalXI(squad,matches,data.teams,gw):null;
    const topPlayers=data.elements.filter(p=>p.minutes>0).map(p=>({p,estimate:playerProjection(p,matches,data.teams,gw,5)})).sort((a,b)=>b.estimate.points-a.estimate.points);
    const rankings=rankClubs(data.teams,matches);
    const question=input.question.toLowerCase();
    const newsNeeded=/injur|news|press|availability|fitness|suspend|rotation|rumou?r/.test(question);
    const news=newsNeeded?await getNews(data.elements,data.teams).catch(()=>[]):[];
    const relevantNews=news.filter(article=>!squad.length||article.playerIds.some(id=>squad.some(p=>p.id===id))||article.teams.some(t=>squad.some(p=>clubName(data.teams,p.team)===t))).slice(0,8);
    const references=[baseRef,...relevantNews.slice(0,4).map(n=>({label:`${n.source}: ${n.title.slice(0,34)}`,url:n.url}))];
    const context={
      gameweek:gw,
      date:new Date().toISOString(),
      squadIsPublicSnapshot:true,
      snapshotGameweek:manager?.snapshotGameweek??null,
      availableFinancialDataIsHistorical:true,
      lastPublishedBankTenths:manager?.entry.last_deadline_bank??null,
      topClubs:rankings.slice(0,15).map(t=>({team:t.name,rating:t.rating,playedLastFive:t.played,points:t.points,goals:t.goals,conceded:t.conceded})),
      projectedPlayers:topPlayers.slice(0,30).map(({p,estimate})=>({id:p.id,name:p.web_name,team:clubName(data.teams,p.team),position:p.element_type,cost:p.now_cost/10,form:p.form,seasonPoints:p.total_points,projected5Gameweeks:estimate.points,range5Gameweeks:[estimate.low,estimate.high],status:p.status,news:p.news})),
      squad:squad.map(p=>({id:p.id,name:p.web_name,team:clubName(data.teams,p.team),position:p.element_type,cost:p.now_cost/10,projectedNext:playerProjection(p,matches,data.teams,gw).points,projected5:playerProjection(p,matches,data.teams,gw,5).points,status:p.status,officialNews:p.news})),
      suggestedXI:xi?{formation:xi.formation,players:xi.starters.map(p=>p.web_name),captain:xi.captain.web_name,vice:xi.vice.web_name,bench:xi.bench.map(p=>p.web_name)}:null,
      news:relevantNews.map(article=>({headline:article.title,source:article.source,publicationDate:article.published,link:article.url})),
      sourceNote:'Only official FPL public data and the provided RSS article headlines, not verified press-conference transcripts.',
      model:'65% season points/game + 35% current FPL form, scaled by minutes, FPL availability and opponent difficulty. Uncalibrated uncertainty intervals.',
      unavailable:'Live private transfers, unused free transfers, confirmed actual budget, chip inventory, xG from paid sources, line-up guarantees and confirmed unpublicised injuries.',
    };
    if (process.env.OPENAI_API_KEY) {
      try {
        const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,timeout:12000,maxRetries:1});
        const response=await client.chat.completions.create({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',temperature:0.2,max_tokens:750,messages:[
          {role:'system',content:'You are a careful FPL research assistant. Ground every factual statement in the provided JSON only. Never invent fixtures, predictions, prices, news, injuries, xG or lineups. Never suggest a transfer is definitely affordable if private bank or selling price is unavailable. Treat GW picks as a historical public snapshot, NOT verified current private picks. Recommend a captain only from legal XI if available. If the question needs unavailable evidence, say so. Distinguish observed data from uncalibrated model estimates. News excerpts are headlines, not confirmed medical facts. Prefer compact answers with one decision, 2-3 numeric reasons and limitations. If referencing a news headline, include its source, publication date and exact URL from context.'},
          {role:'user',content:JSON.stringify({question:input.question,context})}
        ]});
        const answer=response.choices[0]?.message?.content;
        if(answer)return NextResponse.json({answer,mode:'grounded-llm',references});
      } catch { /* Retain the deterministic, live-data-backed fallback. */ }
    }
    let answer='';
    if(/captain|vice/.test(question)) {
      answer=xi?`Captain: ${xi.captain.web_name} (${playerProjection(xi.captain,matches,data.teams,gw).points} estimated points next GW). Vice-captain: ${xi.vice.web_name} (${playerProjection(xi.vice,matches,data.teams,gw).points}). Both feature in a legal ${xi.formation} lineup selected from your public GW ${manager?.snapshotGameweek} squad. This is an uncalibrated model estimate; check official availability and whether your team has changed.`:'Connect your FPL team ID to compare legal captain and vice-captain candidates from your most recent publicly available squad.';
    } else if(/bench|start|lineup|formation/.test(question)) {
      answer=xi?`Suggested ${xi.formation} starting XI (model estimate ${xi.points} points): ${xi.starters.map(p=>p.web_name).join(', ')}. Bench: ${xi.bench.map(p=>p.web_name).join(', ')}. Captain candidate: ${xi.captain.web_name}. These picks are based on a historical squad snapshot and need checking before the deadline.`:'Connect a 15-player public FPL squad for a legal formation-aware starting-XI suggestion.';
    } else if(/chip|wildcard|free hit|triple captain|bench boost/.test(question)) {
      answer='I can model your squad’s next fixtures, but I cannot verify your unused chips through the public FPL API. Check your official account’s chip inventory and current squad before making that decision.';
    } else if(/transfer|sell|replace|buy|\-4|hit/.test(question)) {
      if(!squad.length) answer='Connect your FPL manager ID for transfer suggestions based on your published squad. Current selling values, available free transfers and bank balance may be private.';
      else {
        const projectedSquad=squad.map(p=>({p,pred:playerProjection(p,matches,data.teams,gw,5).points})).sort((a,b)=>a.pred-b.pred);
        const worst=projectedSquad[0].p;
        const ownedPick=picks.find(p=>p.element===worst.id);
        const options=transferCandidates(worst,squad,data.elements,matches,data.teams,gw,manager?.entry.last_deadline_bank??0,ownedPick?.selling_price??worst.now_cost);
        const best=options.find(p=>p.gain>0);
        answer=best?`Potential transfer: ${worst.web_name} → ${best.web_name}. Estimated next-five-GW gain: +${best.gain} points (${best.predicted} estimated points for ${best.web_name}). This respects position and three-per-club constraints with a *provisional* historical budget. ${/\-4|hit/.test(question)?best.gain>4?'The modelled five-week gain exceeds 4, but that alone does not prove a points hit is wise.':'The modelled five-week gain does not exceed 4; a points hit is hard to justify on these figures alone.':''} Verify the actual selling price, free transfers, and captaincy impact in official FPL.`:'There is no positive five-gameweek replacement within provisional position, club and budget constraints for the weakest projected asset. Saving a transfer could be reasonable, but your private free-transfer count is unavailable.';
      }
    } else if(/fixture|easiest|schedule|double|blank/.test(question)) {
      const easiest=data.teams.map(t=>{const fs=fixtureWindow(matches,t.id,gw,5);return {t,avg:fs.length?round(fs.reduce((s,f)=>s+fixtureDifficulty(f,t.id),0)/fs.length):null};}).filter((x):x is {t:typeof data.teams[number];avg:number}=>x.avg!==null).sort((a,b)=>a.avg-b.avg);
      answer=`Easiest next-five-GW opponents by official FPL fixture difficulty (lower is easier): ${easiest.slice(0,5).map(x=>`${x.t.short_name} ${x.avg.toFixed(1)}`).join(', ')}. Blanks and doubles are accounted for by gameweek; see the Fixture Planner for exact opponents.`;
    } else if(/defen|attack|club|team|form|strong/.test(question)) {
      answer=`Top club strength scores right now: ${rankings.slice(0,6).map(t=>`${t.short_name} ${t.rating}/100 (${t.points} points from ${t.played} recent matches)`).join('; ')}. Scoring formula: 38% FPL strength, 32% last-five result points, 18% goals, 12% goals conceded. This is a transparent comparison, not a probability of winning.`;
    } else if(newsNeeded){
      answer=relevantNews.length?`Latest accessible headlines:\n${relevantNews.slice(0,5).map(article=>`• ${article.title} (${article.source}; ${article.published.slice(0,10)}) — ${article.url}`).join('\n')}\nThese headlines aren't independent confirmation of injuries or expected lineups. Check the articles and official club sources.`:'No relevant verified feed articles could be retrieved just now. Current FPL player status and official FPL news fields are visible in Player Rankings; do not assume missing headlines mean a player is fit.';
    } else {
      answer=`Highest estimated five-GW returns: ${topPlayers.slice(0,5).map(({p,estimate})=>`${p.web_name} ${estimate.points} xPts`).join('; ')}. These estimates are uncalibrated and drawn from official player form, minutes and upcoming fixtures. Ask about captaincy, team rankings or transfers for a more specific recommendation.`;
    }
    return NextResponse.json({answer,mode:'deterministic',references});
  } catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Live FPL service unavailable'},{status:503});}
}