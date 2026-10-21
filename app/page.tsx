'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeftRight, ArrowRight, ArrowUpRight, BarChart3, Bot, CalendarDays, Check, ChevronRight, CircleAlert, CircleHelp, Clock3, Command, Database, Filter, LayoutDashboard, Menu, MessageCircle, RefreshCw, Search, Send, ShieldCheck, Sparkles, Target, Trophy, Users, X } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import type { Bootstrap, Fixture, Player, Pick, Entry, NewsArticle } from '@/lib/types';
import { availability, clubName, cost, fixtureDifficulty, fixtureWindow, optimalXI, playerProjection, rankClubs, round, transferCandidates } from '@/lib/fpl';

type Live = { data:Bootstrap; fixtures:Fixture[]; gameweek:number; updatedAt:string };
type Team = { entry:Entry; selection:{ picks:Pick[];active_chip?:string|null }|null; snapshotGameweek:number|null; isHistorical:boolean; updatedAt:string };
type ChatMessage = { role:'user'|'assistant'; text:string; refs?:{label:string;url:string}[] };
const NAV = [
  { label:'AI Assistant',icon:MessageCircle }, { label:'My FPL Team',icon:Users },
  { label:'Player Rankings',icon:Trophy }, { label:'Team Form & Strength',icon:Activity },
  { label:'Fixture Planner',icon:CalendarDays }, { label:'Transfer Planner',icon:ArrowLeftRight },
  { label:'Injury & News',icon:CircleAlert }, { label:'GW Predictions',icon:Target },
];
const PROMPTS = ['Best value players right now?', 'Which teams are in form?', 'Best midfielders under £8m', 'Who should I captain this GW?', 'Easiest fixtures, next 5'];
const POSITION = ['','GKP','DEF','MID','FWD'];
const fmt = (n:number|null|undefined)=>typeof n==='number'?n.toLocaleString():'—';
const friendlyTime = (s:string)=>new Date(s).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const readableError = (e:unknown)=>e instanceof Error?e.message:'Unable to retrieve live data.';

function Metric({ icon:Icon,title,value,detail,accent=false }:{icon:typeof Target;title:string;value:string|number;detail:string;accent?:boolean}) {
  return <div className="metric-panel"><div className="metric-upper"><span>{title}</span><Icon size={17}/></div><div className={accent?'metric-number highlight':'metric-number'}>{value}</div><span className="metric-detail">{detail}</span></div>;
}
function Horizon({value,onChange}:{value:number;onChange:(n:number)=>void}) {
  return <div className="horizon" aria-label="Prediction horizon">{[1,3,5,8].map(n=><button key={n} type="button" className={n===value?'selected':''} onClick={()=>onChange(n)}>{n} GW</button>)}</div>;
}
function SectionHead({eyebrow,title,detail,children}:{eyebrow?:string;title:string;detail?:string;children?:React.ReactNode}) {
  return <div className="section-head"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{detail&&<p className="muted small-space">{detail}</p>}</div>{children}</div>;
}
function Empty({text}:{text:string}){return <div className="empty"><CircleHelp size={24}/><p>{text}</p></div>}
function PlayerName({player,clubs}:{player:Player;clubs:Bootstrap['teams']}){return <span className="person"><span className="avatar">{player.web_name.slice(0,2).toUpperCase()}</span><span><b>{player.web_name}</b><small>{clubName(clubs,player.team)} · {POSITION[player.element_type]}</small></span></span>}

export default function Home() {
  const [tab,setTab]=useState(0);
  const [live,setLive]=useState<Live|null>(null);
  const [team,setTeam]=useState<Team|null>(null);
  const [teamId,setTeamId]=useState('');
  const [loading,setLoading]=useState(true);
  const [importing,setImporting]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const [news,setNews]=useState<NewsArticle[]>([]);
  const [newsError,setNewsError]=useState('');
  const [mineOnly,setMineOnly]=useState(false);
  const [query,setQuery]=useState('');
  const [messages,setMessages]=useState<ChatMessage[]>([{role:'assistant',text:'Hey! I’m your FPL research assistant. Connect a team ID to get personalised advice, or ask about fixtures, rankings and player form. I use real FPL data and label estimates.'}]);
  const [asking,setAsking]=useState(false);
  const [horizon,setHorizon]=useState(5);
  const [positionFilter,setPositionFilter]=useState(0);
  const [playerSearch,setPlayerSearch]=useState('');
  const [outId,setOutId]=useState<number|null>(null);
  const [sidebarOpen,setSidebarOpen]=useState(false);
  const bottomRef=useRef<HTMLDivElement>(null);

  const fetchNews=useCallback(async()=>{
    try {const r=await fetch('/api/news?refresh=1',{cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error(body.error||'Football feeds unavailable');setNews(body.articles??[]);setNewsError('');}
    catch(e){setNewsError(readableError(e));}
  },[]);
  const refresh=useCallback(async()=>{
    setRefreshing(true);
    try {const r=await fetch('/api/bootstrap',{cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error(body.error||'FPL temporarily unavailable');setLive(body);setError('');}
    catch(e){setError(readableError(e));}
    finally {setLoading(false);setRefreshing(false);}
  },[]);
  const importTeam=useCallback(async(id:string,silent=false)=>{
    if (!/^\d{1,9}$/.test(id)||Number(id)<1){if(!silent)setError('Enter a valid numerical FPL team ID.');return;}
    setImporting(true);
    try {const r=await fetch(`/api/team?id=${encodeURIComponent(id)}`,{cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error(body.error||'Team could not be loaded');setTeam(body);localStorage.setItem('fpl-team-id',id);setTeamId(id);setError('');}
    catch(e){if(!silent)setError(readableError(e));}
    finally{setImporting(false)}
  },[]);
  useEffect(()=>{const saved=localStorage.getItem('fpl-team-id');if(saved){setTeamId(saved);void importTeam(saved,true);}void Promise.all([refresh(),fetchNews()]);},[refresh,fetchNews,importTeam]);
  useEffect(()=>bottomRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}),[messages]);

  const clubs=live?.data.teams??[];
  const squad=useMemo(()=>team?.selection?.picks.map(p=>({pick:p,player:live?.data.elements.find(x=>x.id===p.element)})).filter((x):x is {pick:Pick;player:Player}=>!!x.player)??[],[team,live]);
  const ranking=useMemo(()=>live?rankClubs(live.data.teams,live.fixtures):[],[live]);
  const projections=useMemo(()=>live?live.data.elements.filter(p=>p.minutes>0).map(p=>({player:p,estimate:playerProjection(p,live.fixtures,live.data.teams,live.gameweek,horizon)})).sort((a,b)=>b.estimate.points-a.estimate.points):[],[live,horizon]);
  const filteredPlayers=useMemo(()=>projections.filter(({player:p})=>(positionFilter===0||p.element_type===positionFilter)&&(!playerSearch||`${p.web_name} ${p.first_name} ${p.second_name} ${clubName(clubs,p.team)}`.toLowerCase().includes(playerSearch.toLowerCase()))),[projections,positionFilter,playerSearch,clubs]);
  const xi=useMemo(()=>live&&squad.length===15?optimalXI(squad.map(s=>s.player),live.fixtures,clubs,live.gameweek):null,[live,squad,clubs]);
  const outgoing=squad.find(s=>s.player.id===outId);
  const sellingPrice=outgoing?.pick.selling_price ?? outgoing?.player.now_cost ?? 0;
  const candidates=live&&outgoing?transferCandidates(outgoing.player,squad.map(s=>s.player),live.data.elements,live.fixtures,clubs,live.gameweek,team?.entry.last_deadline_bank??0,sellingPrice):[];
  const estimate=(p:Player,n=1)=>live?playerProjection(p,live.fixtures,clubs,live.gameweek,n).points:0;
  const fixtureGrid=useMemo(()=>live?clubs.map(club=>{
    const weeks=Array.from({length:horizon},(_,i)=>{
      const gw=live.gameweek+i;
      return fixtureWindow(live.fixtures,club.id,gw,1).filter(x=>x.event===gw);
    });
    const all=weeks.flat();return {club,weeks,avg:all.length?round(all.reduce((sum,f)=>sum+fixtureDifficulty(f,club.id),0)/all.length):null};
  }).sort((a,b)=>(a.avg??99)-(b.avg??99)):[],[live,clubs,horizon]);
  const relevantNews=useMemo(()=>news.filter(a=>!mineOnly||a.playerIds.some(pid=>squad.some(s=>s.player.id===pid))||a.teams.some(t=>squad.some(s=>clubName(clubs,s.player.team)===t))),[news,mineOnly,squad,clubs]);
  const topTeamNews=news.filter(a=>a.playerIds.some(pid=>squad.some(s=>s.player.id===pid))).length;

  async function ask(question=query) {
    const text=question.trim();if(!text||asking)return;
    setQuery('');setTab(0);setMessages(previous=>[...previous,{role:'user',text}]);setAsking(true);
    try {const response=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:text,teamId:team?Number(teamId):null})});const body=await response.json();setMessages(previous=>[...previous,{role:'assistant',text:body.answer||body.error||'No answer available.',refs:body.references}]);}
    catch {setMessages(previous=>[...previous,{role:'assistant',text:'The assistant could not reach the data service. Try again later.'}]);}
    finally{setAsking(false)}
  }

  const comparison = live ? [...live.data.elements].filter(p=>p.minutes>=180 && p.status==='a').sort((a,b)=>Number(b.points_per_game)-Number(a.points_per_game)).slice(0,2) : [];
  const spotlight = squad.length ? squad.slice(0,5) : [];

  return <div className="ask-app">
    <header className="ask-header">
      <div className="ask-header-inner">
        <button className="ask-wordmark" aria-label="FPL Intelligence home" onClick={()=>setTab(0)}><span className="ask-mark">✳</span> fpl<span>intel</span><span className="brand-period">.</span></button>
        <nav className="ask-topnav" aria-label="Main navigation">
          <button className={tab===0?'current':''} onClick={()=>setTab(0)}>Ask AI</button>
          <button className={tab===1?'current':''} onClick={()=>setTab(1)}>My squad</button>
          <details className="nav-explore"><summary className={tab>=2?'current':''}>Explore <ChevronRight size={13}/></summary><div className="nav-explore-menu">{NAV.slice(2).map(({label,icon:Icon},i)=><button key={label} onClick={e=>{setTab(i+2);e.currentTarget.closest('details')?.removeAttribute('open')}}><Icon size={15}/>{label}</button>)}</div></details>
        </nav>
        <div className="ask-header-right"><span className={'ask-online '+(live?'is-online':'')}><span className="status-dot"/>{live?'FPL data connected':'Public FPL data'}</span><button className="ask-outline-link" onClick={()=>setTab(1)}>My team <ArrowUpRight size={14}/></button></div>
      </div>
    </header>
    <main className="ask-main">
      {tab===0&&<>
        <section className="ask-hero">
          <div className="ask-hero-kicker"><span className="ask-online-dot"/> YOUR FPL RESEARCH ASSISTANT</div>
          <h1>One question.<br/><span>A smarter FPL decision.</span></h1>
          <p className="ask-hero-description">Player rankings, comparisons and fixtures straight from the data. Ask about your squad or the wider Premier League — the numbers are checked, not guessed.</p>
          <div className="ask-prompt-grid">{PROMPTS.map(p=><button key={p} onClick={()=>void ask(p)} disabled={asking}>{p}<ArrowUpRight size={14}/></button>)}</div>
          <form className="ask-composer" onSubmit={e=>{e.preventDefault();void ask()}}><Search size={19}/><input aria-label="Ask FPL Intelligence" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ask the question you have…"/><button type="submit" disabled={!query.trim()||asking} aria-label="Submit question"><ArrowRight size={19}/></button></form>
          <div className="ask-composer-caption"><ShieldCheck size={14}/> No account needed · Actual public FPL numbers · No invented statistics</div>
          {messages.length>1&&<div className="ask-conversation" role="log" aria-live="polite">{messages.slice(1).map((m,i)=><div className={'ask-message '+m.role} key={i}><div className="ask-message-label">{m.role==='user'?'YOU':'FPL INTELLIGENCE'}</div><p>{m.text}</p>{m.refs?.length?<div className="references">{m.refs.map(ref=><a key={ref.url} href={ref.url} target="_blank" rel="noopener noreferrer">{ref.label} <ArrowUpRight size={12}/></a>)}</div>:null}</div>)}{asking&&<div className="ask-message assistant">Checking the latest published numbers…</div>}<div ref={bottomRef}/></div>}
          {messages.length===1&&<div className="ask-note">{live?`Updated ${friendlyTime(live.updatedAt)} · Gameweek ${live.gameweek}`:loading?'Connecting to public FPL data…':error?'Live data unavailable right now — try refresh.':'Waiting for FPL data'}</div>}
        </section>
        <section className="ask-showcase">
          <div className="showcase-heading"><span className="small-overline">WHAT AN ANSWER LOOKS LIKE</span><h2>All the context.<br/>None of the guesswork.</h2><p>Numbers you can compare at a glance. Every figure is sourced from the official FPL feed or clearly marked as an estimate.</p></div>
          <div className="ask-showcase-grid">
            <article className="sample-card">
              <div className="sample-card-top"><div><span className="small-overline">PLAYER COMPARISON</span><h3>Who deserves the armband?</h3></div><span className="sample-tag">Official records</span></div>
              {comparison.length===2?<><div className="compare-players">{comparison.map(p=><div className="compare-person" key={p.id}><span className="compare-monogram">{p.web_name.slice(0,2).toUpperCase()}</span><strong>{p.web_name}</strong><small>{clubName(clubs,p.team)} · £{cost(p.now_cost)}m</small></div>)}</div><div className="compare-rows">{[['Total FPL points','total_points'],['Points / game','points_per_game'],['Recent form','form'],['Minutes played','minutes'],['Ownership %','selected_by_percent']].map(([label,key])=><div className="compare-row" key={key}><strong>{String(comparison[0][key as keyof Player]??'—')}</strong><span>{label}</span><strong>{String(comparison[1][key as keyof Player]??'—')}</strong></div>)}</div><p className="sample-disclaimer">Observed current-season FPL metrics, not projected certainty.</p></>:<div className="sample-pending"><Activity size={20}/>{loading?'Retrieving official player statistics…':'Player comparison becomes available when live FPL data loads.'}</div>}
            </article>
            <article className="sample-card squad-sample"><div className="sample-card-top"><div><span className="small-overline">YOUR REAL FPL SQUAD</span><h3>{team?team.entry.name:'See your 15-player squad'}</h3></div><span className="sample-tag">{team?`GW ${team.snapshotGameweek}`:'Connect team'}</span></div>
              {spotlight.length?<><div className="squad-sample-list">{spotlight.map(({player:p})=><div key={p.id} className="squad-sample-row"><PlayerName player={p} clubs={clubs}/><span>£{cost(p.now_cost)}m</span><b>{p.total_points} pts</b></div>)}</div><p className="sample-disclaimer">Most recent published squad snapshot; private changes may differ.</p></>:<><div className="sample-empty-squad"><Users size={28}/><p>Enter your team ID to unlock captain picks, transfer decisions and your published lineup.</p></div><form className="sample-team-form" onSubmit={e=>{e.preventDefault();void importTeam(teamId)}}><input aria-label="Your FPL Team ID" placeholder="Your FPL team ID" value={teamId} onChange={e=>setTeamId(e.target.value)} inputMode="numeric" maxLength={9}/><button type="submit" disabled={importing}>{importing?'Loading…':'Connect'} <ArrowRight size={15}/></button></form></>}
            </article>
          </div>
        </section>
        <section className="ask-how"><div className="showcase-heading"><span className="small-overline">HOW IT WORKS</span><h2>Ask. Compare. Decide.</h2></div><div className="ask-how-grid">{[['01','Ask your question','Captain picks, transfers, under-the-radar midfielders or team form. No complicated filters required.'],['02','We check the data','The assistant queries official FPL records and makes its calculations explicit.'],['03','Make your move','Read a concise answer, inspect the evidence and decide what to do.']].map(([n,title,detail])=><article className="how-item" key={n}><span>{n}</span><h3>{title}</h3><p>{detail}</p></article>)}</div></section>
        <section className="ask-tool-section"><div className="showcase-heading"><span className="small-overline">EXPLORE MORE</span><h2>Everything for your gameweek.</h2><p>One workspace for the tools behind each recommendation.</p></div><div className="ask-tool-grid">{NAV.slice(1).map(({label,icon:Icon},i)=><button key={label} onClick={()=>setTab(i+1)}><Icon size={20}/><span>{label}</span><ArrowUpRight size={16}/></button>)}</div></section>
        {error&&<div role="alert" className="alert error"><CircleAlert size={17}/>{error}<button className="subtle-button" onClick={()=>void refresh()}>Retry</button></div>}
      </>}
      {tab!==0&&<div className="ask-workspace">
        <div className="workspace-back"><button onClick={()=>setTab(0)}><ArrowRight size={15}/> Back to AI assistant</button><span>{live?'Data updated '+friendlyTime(live.updatedAt):'FPL live data pending'} <button className="workspace-refresh" aria-label="Refresh data" onClick={()=>void Promise.all([refresh(),fetchNews()])}><RefreshCw size={13} className={refreshing?'spin':''}/></button></span></div>
        <div className="workspace-heading"><span className="small-overline">FPL INTELLIGENCE / WORKBENCH</span><h1>{NAV[tab].label}</h1><p>Real football data, useful comparisons and clearly labelled estimates.</p></div>
        <div className="connect-row"><div className="connect-info"><div className="connect-icon"><Users size={18}/></div><div><b>{team?team.entry.name:'Connect your FPL team'}</b><span>{team?`Public squad snapshot · GW ${team.snapshotGameweek??'unknown'} · rank ${fmt(team.entry.summary_overall_rank)}`:'Enter your public manager ID for personalised analysis'}</span></div></div><form className="connect-form" onSubmit={e=>{e.preventDefault();void importTeam(teamId)}}><input aria-label="FPL team ID" inputMode="numeric" placeholder="FPL Team ID" value={teamId} onChange={e=>setTeamId(e.target.value)} maxLength={9}/><button className="button-primary" disabled={importing}>{importing?'Importing…':team?'Refresh team':'Connect team'} <ArrowRight size={15}/></button></form></div>
        {error&&<div role="alert" className="alert error"><CircleAlert size={17}/>{error}<button className="subtle-button" onClick={()=>void refresh()}>Retry</button></div>}
        {loading&&<div className="loading-note"><RefreshCw size={16} className="spin"/>Fetching public Fantasy Premier League data…</div>}
        {live&&<>
          {tab===1&&<div className="content-grid"><section className="panel pitch-panel"><SectionHead eyebrow="YOUR LINEUP" title="Squad on the pitch" detail={team?`Latest available public picks · GW ${team.snapshotGameweek}`:'Import your team to see your squad.'}/>{squad.length?<><div className="pitch"><div className="pitch-circle"/><div className="pitch-box pitch-box-top"/><div className="pitch-box pitch-box-bottom"/>{[4,3,2,1].map(pos=><div className="pitch-row" key={pos}>{squad.filter(s=>s.player.element_type===pos&&s.pick.position<=11).map(({player,pick})=><div key={player.id} className="pitch-player"><div className="shirt"><span>{POSITION[pos]}</span>{pick.is_captain&&<i>C</i>}{pick.is_vice_captain&&<i>V</i>}</div><strong>{player.web_name}</strong><small>{estimate(player)} xPts · £{cost(player.now_cost)}</small></div>)}</div>)}</div><div className="bench-strip"><span>SUBSTITUTES</span>{squad.filter(s=>s.pick.position>11).sort((a,b)=>a.pick.position-b.pick.position).map(({player})=><div key={player.id}><b>{player.web_name}</b><small>{POSITION[player.element_type]} · {estimate(player)} xPts</small></div>)}</div></>:<Empty text="Enter your FPL team ID above. We’ll retrieve the latest squad snapshot available publicly."/>}</section><aside className="panel"><SectionHead eyebrow="SQUAD ANALYSIS" title="Optimal XI suggestion" detail="Experimental one-gameweek estimated points, respecting legal FPL formations."/>{xi?<><div className="recommended-lineup"><div className="row between"><span>Suggested formation</span><strong className="highlight">{xi.formation}</strong></div><div className="row between"><span>XI projected points</span><strong>{xi.points}</strong></div><div className="row between"><span>Captain candidate</span><strong>{xi.captain.web_name}</strong></div><div className="row between"><span>Vice-captain</span><strong>{xi.vice.web_name}</strong></div></div><button className="button-secondary full-width" onClick={()=>void ask('Who should I start and captain this gameweek?')}>Explain my suggested XI <ArrowRight size={16}/></button></>:<Empty text="Connect a full 15-player public squad to see formation-aware recommendations."/>}{team&&<div className="alert neutral"><CircleHelp size={18}/>GW {team.snapshotGameweek} is a <strong>historical public snapshot.</strong> Private transfers, actual bank and chip balances may have changed since then.</div>}</aside></div>}

          {tab===2&&<section className="panel"><SectionHead eyebrow="PLAYER SCOUTING" title="Player rankings" detail="Sort players by estimated returns for the next gameweeks."><Horizon value={horizon} onChange={setHorizon}/></SectionHead><div className="toolbar"><div className="searchbox"><Search size={17}/><input aria-label="Search players" placeholder="Search player or club" value={playerSearch} onChange={e=>setPlayerSearch(e.target.value)}/></div><div className="position-buttons"><Filter size={15}/>{['All','GK','DEF','MID','FWD'].map((name,i)=><button className={positionFilter===i?'selected':''} onClick={()=>setPositionFilter(i)} key={name}>{name}</button>)}</div></div><div className="table-scroll"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>PRICE</th><th>FORM</th><th>SEASON PTS</th><th>FIXTURES</th><th>EST. POINTS</th><th>EST. RANGE</th></tr></thead><tbody>{filteredPlayers.slice(0,90).map(({player:p,estimate:e},i)=><tr key={p.id}><td><span className="table-rank">{i+1}</span></td><td><PlayerName player={p} clubs={clubs}/></td><td>£{cost(p.now_cost)}m</td><td>{p.form}</td><td>{p.total_points}</td><td>{e.fixtureCount}</td><td className="highlight"><strong>{e.points}</strong></td><td className="muted">{e.low} – {e.high}</td></tr>)}</tbody></table></div><p className="footnote">Estimates use official prices, FPL form, minutes, player status and fixture difficulty. Ranges are heuristic, not calibrated confidence intervals.</p></section>}

          {tab===3&&<div className="content-grid"><section className="panel"><SectionHead eyebrow="PREMIER LEAGUE / 20 CLUBS" title="Club power index" detail="A transparent blend of official strength ratings and five-match form."/><div className="table-scroll"><table><thead><tr><th>#</th><th>CLUB</th><th>RATING</th><th>FORM PTS</th><th>GOALS</th><th>CONCEDED</th><th>CS</th></tr></thead><tbody>{ranking.map((c,i)=><tr key={c.id}><td><span className="table-rank">{i+1}</span></td><td><b>{c.name}</b></td><td><span className="rating"><i style={{width:c.rating+'%'}}/><b>{c.rating}</b></span></td><td>{c.points}/{c.played*3}</td><td>{c.goals}</td><td>{c.conceded}</td><td>{c.cleanSheets}</td></tr>)}</tbody></table></div></section><aside className="right-stack"><div className="panel"><SectionHead eyebrow="TOP 6 CLUBS" title="Relative strength"/><div className="chart"><ResponsiveContainer width="100%" height={240}><BarChart data={ranking.slice(0,6).map(c=>({name:c.short_name,rating:c.rating}))} layout="vertical" margin={{left:0,right:12}}><CartesianGrid stroke="#273438" strokeDasharray="2 5" horizontal={false}/><XAxis type="number" domain={[0,100]} tick={{fill:'#839691',fontSize:11}}/><YAxis type="category" dataKey="name" width={40} tick={{fill:'#c0cfcb',fontSize:11}}/><Tooltip contentStyle={{background:'#152323',border:'1px solid #3a5047',borderRadius:12,color:'#f1f7f4'}}/><Bar dataKey="rating" fill="#b0f479" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div></div><div className="panel"><div className="eyebrow">HOW IT WORKS</div><h3>Open calculation</h3><p className="muted">38% official FPL strength index + 32% last-five points rate + 18% recent goals scored + 12% recent defensive record. These are comparative indicators, not probabilities.</p></div></aside></div>}

          {tab===4&&<section className="panel"><SectionHead eyebrow="UPCOMING SCHEDULE" title="Fixture difficulty planner" detail="Blank and double gameweeks are shown explicitly, using official FPL opponent grades (1 = easiest)."><Horizon value={horizon} onChange={setHorizon}/></SectionHead><div className="table-scroll"><table className="fixture-table"><thead><tr><th>CLUB</th><th>AVG DIFF.</th>{Array.from({length:horizon},(_,i)=><th key={i}>GW {live.gameweek+i}</th>)}</tr></thead><tbody>{fixtureGrid.map(({club,weeks,avg})=><tr key={club.id}><td><b>{club.name}</b></td><td>{avg??'—'}</td>{weeks.map((week,i)=><td key={i}><div className="fixture-cell">{week.length===0?<span className="fixture-blank">BLANK</span>:week.map(f=>{const home=f.team_h===club.id;const opponent=home?f.team_a:f.team_h;const grade=fixtureDifficulty(f,club.id);return <span key={f.id} className={'fixture-grade grade-'+grade}>{clubName(clubs,opponent)} <small>{home?'H':'A'}</small></span>})}</div></td>)}</tr>)}</tbody></table></div><p className="footnote">The planner groups matches by actual gameweek rather than assuming one fixture per week. Unassigned fixtures are not included.</p></section>}

          {tab===5&&<section className="panel"><SectionHead eyebrow="TRANSFER LAB" title="Find your next upgrade" detail="Compare realistic positional replacements within a provisional budget. Your actual squad is never changed."/>{squad.length?<><div className="transfer-controls"><label>TRANSFER OUT<select value={outId??''} onChange={e=>setOutId(e.target.value?Number(e.target.value):null)}><option value="">Choose a player in your squad</option>{squad.map(({player:p})=><option key={p.id} value={p.id}>{p.web_name} · {clubName(clubs,p.team)} · £{cost(p.now_cost)}m</option>)}</select></label><div className="transfer-budget"><span>PUBLISHED BANK BALANCE</span><b>£{cost(team?.entry.last_deadline_bank??0)}m</b><small>From historical manager profile</small></div></div>{outgoing&&<><div className="transfer-out"><span>SELL</span><PlayerName player={outgoing.player} clubs={clubs}/><ArrowRight size={21}/><span>BUY OPTIONS</span></div><div className="table-scroll"><table><thead><tr><th>OPTION</th><th>PLAYER IN</th><th>PRICE</th><th>5 GW EST.</th><th>EST. GAIN</th><th>AVAILABILITY</th></tr></thead><tbody>{candidates.map((p,i)=><tr key={p.id}><td>{i+1}</td><td><PlayerName player={p} clubs={clubs}/></td><td>£{cost(p.now_cost)}m</td><td><strong>{p.predicted}</strong></td><td className={p.gain>0?'highlight':'muted'}>{p.gain>0?'+':''}{p.gain}</td><td>{p.status==='a'?<span className="available"><Check size={13}/> FPL available</span>:<span className="caution">{p.news||'Status needs checking'}</span>}</td></tr>)}</tbody></table></div>{!candidates.length&&<Empty text="No replacements pass the current position, club and provisional budget filters."/>}</> }<div className="alert neutral"><ShieldCheck size={20}/>If a GW pick includes a published selling price, that is used; otherwise the current listed price is a provisional substitute. Verify bank, selling value, free transfers and any points hit in official FPL before confirming a move.</div></>:<Empty text="Connect your FPL team to unlock transfer suggestions based on your 15-player squad."/>}</section>}

          {tab===6&&<section><div className="panel"><SectionHead eyebrow="VERIFIABLE HEADLINES" title="Injury & news centre" detail="Latest accessible RSS headlines, timestamps and publisher links. Headlines are not independent injury confirmations."><div className="news-actions"><label className="checkbox"><input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/> My squad only</label><button className="button-secondary" onClick={()=>void fetchNews()}><RefreshCw size={15}/> Refresh</button></div></SectionHead>{newsError&&<div className="alert neutral"><CircleAlert size={16}/>{newsError}</div>}<div className="news-grid">{relevantNews.map(a=><a className="news-card" href={a.url} target="_blank" rel="noopener noreferrer" key={a.url}><div className="row between"><span className="source-label">{a.source}</span><ArrowUpRight size={16}/></div><h3>{a.title}</h3><p>{a.description}</p><footer><Clock3 size={13}/>{new Date(a.published).getTime()?friendlyTime(a.published):'Date unavailable'}{a.teams.length>0&&<span>· {a.teams.slice(0,3).join(', ')}</span>}</footer></a>)}</div>{!relevantNews.length&&<Empty text={mineOnly?'No headlines currently matched your public squad. Try disabling the squad filter.':'No verified articles are available from the configured feeds right now.'}/>}<p className="footnote">Player associations are possible name matches, not proof that an article concerns a particular FPL asset. Check original articles and official club announcements for confirmation.</p></div></section>}

          {tab===7&&<section className="panel"><SectionHead eyebrow="TRANSPARENT PREDICTION MODEL" title="Gameweek point projections" detail="Estimated totals account for your selected gameweek horizon, blanks, doubles and public FPL availability."><Horizon value={horizon} onChange={setHorizon}/></SectionHead><div className="formula">65% observed season points per match + 35% recent FPL form <span>×</span> minutes factor <span>×</span> FPL availability <span>×</span> opponent fixture factor</div><div className="table-scroll"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>EST. POINTS</th><th>LOW–HIGH</th><th>FIXTURES</th><th>AVG MINS/WEEK</th><th>FPL STATUS</th></tr></thead><tbody>{projections.slice(0,80).map(({player:p,estimate:e},i)=><tr key={p.id}><td>{i+1}</td><td><PlayerName player={p} clubs={clubs}/></td><td className="highlight"><strong>{e.points}</strong></td><td>{e.low}–{e.high}</td><td>{e.fixtureCount}</td><td>{e.minutesPerWeek}</td><td>{p.status==='a'?<span className="available"><Check size={13}/> Available</span>:<span className="caution">{p.news||'Check status'}</span>}</td></tr>)}</tbody></table></div><div className="alert neutral"><CircleHelp size={20}/>Prediction intervals are illustrative and uncalibrated, not statistically guaranteed. xG/xA and reliable line-up probability aren't included unless supplied by a permitted data provider.</div></section>}
        </>}
      </div>}
        <footer className="site-footer"><span>© {new Date().getFullYear()} FPL Intelligence · Independent research platform, not affiliated with the Premier League.</span><span><span className="status-dot"/> Official FPL public data · <a href="https://fantasy.premierleague.com/" target="_blank" rel="noopener noreferrer">Source <ArrowUpRight size={12}/></a></span></footer>
    </main>
  </div>;
}