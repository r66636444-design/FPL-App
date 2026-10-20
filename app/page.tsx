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
const PROMPTS = ['Who should I captain this gameweek?', 'What is the best transfer for my team?', 'Who has the easiest next 5 gameweeks?', 'Who should I bench this week?', 'Is a -4 transfer hit worthwhile?', 'Which clubs are strongest in attack?'];
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

  return <div className="app-shell">
    <aside className={'sidebar '+(sidebarOpen?'open':'')}>
      <div className="brand"><div className="brand-symbol"><Activity size={23} strokeWidth={3}/></div><div><b>FPL<span>INTEL</span></b><small>YOUR FOOTBALL EDGE</small></div><button className="mobile-close icon-btn" aria-label="Close menu" onClick={()=>setSidebarOpen(false)}><X size={20}/></button></div>
      <div className="nav-heading">WORKSPACE</div>
      <nav className="navigation" aria-label="Main navigation">{NAV.map(({label,icon:Icon},i)=><button key={label} className={'nav-item '+(tab===i?'active':'')} onClick={()=>{setTab(i);setSidebarOpen(false)}}><Icon size={18}/><span>{label}</span>{tab===i&&<span className="nav-indicator"/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="live-status"><span className={'status-dot '+(!live?'offline':'')}/>{live?'Official data connected':'Awaiting FPL data'}</div><p>Independent FPL research · All projections are estimates.</p><a href="https://fantasy.premierleague.com/" target="_blank" rel="noopener noreferrer">Official Fantasy Premier League <ArrowUpRight size={13}/></a></div>
    </aside>
    {sidebarOpen&&<button aria-label="Dismiss menu" className="sidebar-backdrop" onClick={()=>setSidebarOpen(false)}/>}
    <main className="main">
      <header className="topbar"><button className="icon-btn mobile-menu" aria-label="Open menu" onClick={()=>setSidebarOpen(true)}><Menu size={21}/></button><span className="breadcrumb">WORKSPACE <ChevronRight size={14}/> <b>{NAV[tab].label}</b></span><div className="top-actions"><div className="data-time"><Clock3 size={14}/>{live?'Updated '+friendlyTime(live.updatedAt):'Not connected'}</div><button className="icon-btn refresh-btn" aria-label="Refresh FPL data" title="Refresh FPL data" onClick={()=>void Promise.all([refresh(),fetchNews()])} disabled={refreshing}><RefreshCw className={refreshing?'spin':''} size={17}/></button><span className="top-tag">{live?.data.events[0]?.deadline_time ? (()=>{const y=new Date(live.data.events[0].deadline_time).getUTCFullYear();return `${y} / ${String(y+1).slice(2)}`})() : "FPL LIVE"}</span></div></header>
      <div className="content">
        <section className="welcome"><div className="eyebrow"><span className="live-pulse"/> THE FPL COMMAND CENTRE</div><h1>{tab===0?'Your unfair advantage.':NAV[tab].label}</h1><p>{tab===0?'Smarter transfers, stronger captaincy and a clearer view of every gameweek. Powered by official FPL data.':'Turn real football data into informed fantasy decisions.'}</p></section>
        <div className="connect-row"><div className="connect-info"><div className="connect-icon"><Database size={18}/></div><div><b>{team?team.entry.name:'Connect your FPL team'}</b><span>{team?`Public squad snapshot · GW ${team.snapshotGameweek??'unknown'} · rank ${fmt(team.entry.summary_overall_rank)}`:'Enter your FPL manager ID to unlock personalised analysis'}</span></div></div><form className="connect-form" onSubmit={e=>{e.preventDefault();void importTeam(teamId)}}><input aria-label="FPL team ID" inputMode="numeric" placeholder="FPL Team ID" value={teamId} onChange={e=>setTeamId(e.target.value)} maxLength={9}/><button className="button-primary" disabled={importing}>{importing?<RefreshCw className="spin" size={16}/>:team?<RefreshCw size={16}/>:<ArrowRight size={16}/>} {importing?'Importing':team?'Reload squad':'Connect team'}</button></form></div>
        {error&&<div role="alert" className="alert error"><CircleAlert size={17}/>{error}<button className="subtle-button" onClick={()=>void refresh()}>Retry</button></div>}
        {loading&&<div className="loading-note"><RefreshCw size={16} className="spin"/> Fetching live Fantasy Premier League data…</div>}
        {live&&<>
          <div className="metrics-grid">
            <Metric icon={CalendarDays} title="UPCOMING GAMEWEEK" value={`GW ${live.gameweek}`} detail={live.data.events.find(e=>e.id===live.gameweek)?.deadline_time?'Deadline '+friendlyTime(live.data.events.find(e=>e.id===live.gameweek)!.deadline_time):'From official events'} accent/>
            <Metric icon={Users} title="PLAYERS TRACKED" value={fmt(live.data.elements.length)} detail="Live official FPL records"/>
            <Metric icon={Trophy} title="YOUR OVERALL POINTS" value={team?fmt(team.entry.summary_overall_points):'—'} detail={team?'Official manager profile':'Connect to see your points'}/>
            <Metric icon={CircleAlert} title="SQUAD NEWS MENTIONS" value={team?topTeamNews:'—'} detail="Possible matches in fetched headlines"/>
          </div>

          {tab===0&&<div className="assistant-layout"><section className="assistant-pane"><div className="section-heading"><span className="eyebrow">AI-POWERED FPL RESEARCH</span><h2>Ask better questions.<br/><span>Make better moves.</span></h2><p>Analyse fixtures, captain picks, transfers and club strength. Your advice updates when your data does.</p></div><div className="prompt-chips">{PROMPTS.map((p,i)=><button key={p} onClick={()=>void ask(p)} disabled={asking}><span className="prompt-number">0{i+1}</span>{p}<ArrowUpRight size={14}/></button>)}</div><div className="chat-window"><div className="chat-heading"><span className="assistant-avatar"><Bot size={19}/></span><div><b>FPL Intelligence Assistant</b><small><span className="status-dot"/> Real FPL context · model estimates labelled</small></div><span className="chat-tag">ASSISTANT</span></div><div className="chat-history" role="log" aria-live="polite">{messages.map((m,i)=><div className={'chat-message '+(m.role==='user'?'sent':'received')} key={i}>{m.role==='assistant'&&<span className="mini-avatar"><Sparkles size={14}/></span>}<div className="chat-text">{m.text}{m.refs?.length?<div className="references">{m.refs.map(ref=><a href={ref.url} target="_blank" rel="noopener noreferrer" key={ref.url}>{ref.label} <ArrowUpRight size={12}/></a>)}</div>:null}</div></div>)}{asking&&<div className="chat-message received"><span className="mini-avatar"><Bot size={14}/></span><div className="chat-text typing">Checking FPL data <span>•••</span></div></div>}<div ref={bottomRef}/></div><form className="chat-composer" onSubmit={e=>{e.preventDefault();void ask()}}><input aria-label="Message FPL assistant" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ask anything about your FPL team…"/><button aria-label="Send question" disabled={!query.trim()||asking}><Send size={18}/></button></form></div></section>
          <aside className="insights-pane"><div className="panel tight"><div className="row between"><div className="eyebrow">PROJECTED LEADERS</div><span className="label-chip">NEXT GW</span></div><h3>One gameweek ahead</h3><div className="leader-list">{[...live.data.elements].filter(p=>p.minutes>0).map(p=>({p,pts:estimate(p)})).sort((a,b)=>b.pts-a.pts).slice(0,6).map(({p,pts},i)=><div key={p.id} className="leader"><span className="rank">{String(i+1).padStart(2,'0')}</span><PlayerName player={p} clubs={clubs}/><span className="leader-point">{pts}<small> xPts</small></span></div>)}</div><p className="tiny muted">Transparent heuristics, not official predictions. <button className="link-button" onClick={()=>setTab(7)}>Explore model <ArrowRight size={12}/></button></p></div>
          <div className="panel intel-card"><div className="eyebrow">GAMEWEEK INTELLIGENCE</div><h3>Stay one move ahead.</h3><p>Injury reports, team performance and fixture difficulty, all in one place.</p><div className="intel-bars"><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/><span/></div><button onClick={()=>setTab(6)}>Open News Centre <ArrowRight size={15}/></button></div>
          </aside></div>}

          {tab===1&&<div className="content-grid"><section className="panel pitch-panel"><SectionHead eyebrow="YOUR LINEUP" title="Squad on the pitch" detail={team?`Latest available public picks · GW ${team.snapshotGameweek}`:'Import your team to see your squad.'}/>{squad.length?<><div className="pitch"><div className="pitch-circle"/><div className="pitch-box pitch-box-top"/><div className="pitch-box pitch-box-bottom"/>{[4,3,2,1].map(pos=><div className="pitch-row" key={pos}>{squad.filter(s=>s.player.element_type===pos&&s.pick.position<=11).map(({player,pick})=><div key={player.id} className="pitch-player"><div className="shirt"><span>{POSITION[pos]}</span>{pick.is_captain&&<i>C</i>}{pick.is_vice_captain&&<i>V</i>}</div><strong>{player.web_name}</strong><small>{estimate(player)} xPts · £{cost(player.now_cost)}</small></div>)}</div>)}</div><div className="bench-strip"><span>SUBSTITUTES</span>{squad.filter(s=>s.pick.position>11).sort((a,b)=>a.pick.position-b.pick.position).map(({player})=><div key={player.id}><b>{player.web_name}</b><small>{POSITION[player.element_type]} · {estimate(player)} xPts</small></div>)}</div></>:<Empty text="Enter your FPL team ID above. We’ll retrieve the latest squad snapshot available publicly."/>}</section><aside className="panel"><SectionHead eyebrow="SQUAD ANALYSIS" title="Optimal XI suggestion" detail="Experimental one-gameweek estimated points, respecting legal FPL formations."/>{xi?<><div className="recommended-lineup"><div className="row between"><span>Suggested formation</span><strong className="highlight">{xi.formation}</strong></div><div className="row between"><span>XI projected points</span><strong>{xi.points}</strong></div><div className="row between"><span>Captain candidate</span><strong>{xi.captain.web_name}</strong></div><div className="row between"><span>Vice-captain</span><strong>{xi.vice.web_name}</strong></div></div><button className="button-secondary full-width" onClick={()=>void ask('Who should I start and captain this gameweek?')}>Explain my suggested XI <ArrowRight size={16}/></button></>:<Empty text="Connect a full 15-player public squad to see formation-aware recommendations."/>}{team&&<div className="alert neutral"><CircleHelp size={18}/>GW {team.snapshotGameweek} is a <strong>historical public snapshot.</strong> Private transfers, actual bank and chip balances may have changed since then.</div>}</aside></div>}

          {tab===2&&<section className="panel"><SectionHead eyebrow="PLAYER SCOUTING" title="Player rankings" detail="Sort players by estimated returns for the next gameweeks."><Horizon value={horizon} onChange={setHorizon}/></SectionHead><div className="toolbar"><div className="searchbox"><Search size={17}/><input aria-label="Search players" placeholder="Search player or club" value={playerSearch} onChange={e=>setPlayerSearch(e.target.value)}/></div><div className="position-buttons"><Filter size={15}/>{['All','GK','DEF','MID','FWD'].map((name,i)=><button className={positionFilter===i?'selected':''} onClick={()=>setPositionFilter(i)} key={name}>{name}</button>)}</div></div><div className="table-scroll"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>PRICE</th><th>FORM</th><th>SEASON PTS</th><th>FIXTURES</th><th>EST. POINTS</th><th>EST. RANGE</th></tr></thead><tbody>{filteredPlayers.slice(0,90).map(({player:p,estimate:e},i)=><tr key={p.id}><td><span className="table-rank">{i+1}</span></td><td><PlayerName player={p} clubs={clubs}/></td><td>£{cost(p.now_cost)}m</td><td>{p.form}</td><td>{p.total_points}</td><td>{e.fixtureCount}</td><td className="highlight"><strong>{e.points}</strong></td><td className="muted">{e.low} – {e.high}</td></tr>)}</tbody></table></div><p className="footnote">Estimates use official prices, FPL form, minutes, player status and fixture difficulty. Ranges are heuristic, not calibrated confidence intervals.</p></section>}

          {tab===3&&<div className="content-grid"><section className="panel"><SectionHead eyebrow="PREMIER LEAGUE / 20 CLUBS" title="Club power index" detail="A transparent blend of official strength ratings and five-match form."/><div className="table-scroll"><table><thead><tr><th>#</th><th>CLUB</th><th>RATING</th><th>FORM PTS</th><th>GOALS</th><th>CONCEDED</th><th>CS</th></tr></thead><tbody>{ranking.map((c,i)=><tr key={c.id}><td><span className="table-rank">{i+1}</span></td><td><b>{c.name}</b></td><td><span className="rating"><i style={{width:c.rating+'%'}}/><b>{c.rating}</b></span></td><td>{c.points}/{c.played*3}</td><td>{c.goals}</td><td>{c.conceded}</td><td>{c.cleanSheets}</td></tr>)}</tbody></table></div></section><aside className="right-stack"><div className="panel"><SectionHead eyebrow="TOP 6 CLUBS" title="Relative strength"/><div className="chart"><ResponsiveContainer width="100%" height={240}><BarChart data={ranking.slice(0,6).map(c=>({name:c.short_name,rating:c.rating}))} layout="vertical" margin={{left:0,right:12}}><CartesianGrid stroke="#273438" strokeDasharray="2 5" horizontal={false}/><XAxis type="number" domain={[0,100]} tick={{fill:'#839691',fontSize:11}}/><YAxis type="category" dataKey="name" width={40} tick={{fill:'#c0cfcb',fontSize:11}}/><Tooltip contentStyle={{background:'#152323',border:'1px solid #3a5047',borderRadius:12,color:'#f1f7f4'}}/><Bar dataKey="rating" fill="#b0f479" radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div></div><div className="panel"><div className="eyebrow">HOW IT WORKS</div><h3>Open calculation</h3><p className="muted">38% official FPL strength index + 32% last-five points rate + 18% recent goals scored + 12% recent defensive record. These are comparative indicators, not probabilities.</p></div></aside></div>}

          {tab===4&&<section className="panel"><SectionHead eyebrow="UPCOMING SCHEDULE" title="Fixture difficulty planner" detail="Blank and double gameweeks are shown explicitly, using official FPL opponent grades (1 = easiest)."><Horizon value={horizon} onChange={setHorizon}/></SectionHead><div className="table-scroll"><table className="fixture-table"><thead><tr><th>CLUB</th><th>AVG DIFF.</th>{Array.from({length:horizon},(_,i)=><th key={i}>GW {live.gameweek+i}</th>)}</tr></thead><tbody>{fixtureGrid.map(({club,weeks,avg})=><tr key={club.id}><td><b>{club.name}</b></td><td>{avg??'—'}</td>{weeks.map((week,i)=><td key={i}><div className="fixture-cell">{week.length===0?<span className="fixture-blank">BLANK</span>:week.map(f=>{const home=f.team_h===club.id;const opponent=home?f.team_a:f.team_h;const grade=fixtureDifficulty(f,club.id);return <span key={f.id} className={'fixture-grade grade-'+grade}>{clubName(clubs,opponent)} <small>{home?'H':'A'}</small></span>})}</div></td>)}</tr>)}</tbody></table></div><p className="footnote">The planner groups matches by actual gameweek rather than assuming one fixture per week. Unassigned fixtures are not included.</p></section>}

          {tab===5&&<section className="panel"><SectionHead eyebrow="TRANSFER LAB" title="Find your next upgrade" detail="Compare realistic positional replacements within a provisional budget. Your actual squad is never changed."/>{squad.length?<><div className="transfer-controls"><label>TRANSFER OUT<select value={outId??''} onChange={e=>setOutId(e.target.value?Number(e.target.value):null)}><option value="">Choose a player in your squad</option>{squad.map(({player:p})=><option key={p.id} value={p.id}>{p.web_name} · {clubName(clubs,p.team)} · £{cost(p.now_cost)}m</option>)}</select></label><div className="transfer-budget"><span>PUBLISHED BANK BALANCE</span><b>£{cost(team?.entry.last_deadline_bank??0)}m</b><small>From historical manager profile</small></div></div>{outgoing&&<><div className="transfer-out"><span>SELL</span><PlayerName player={outgoing.player} clubs={clubs}/><ArrowRight size={21}/><span>BUY OPTIONS</span></div><div className="table-scroll"><table><thead><tr><th>OPTION</th><th>PLAYER IN</th><th>PRICE</th><th>5 GW EST.</th><th>EST. GAIN</th><th>AVAILABILITY</th></tr></thead><tbody>{candidates.map((p,i)=><tr key={p.id}><td>{i+1}</td><td><PlayerName player={p} clubs={clubs}/></td><td>£{cost(p.now_cost)}m</td><td><strong>{p.predicted}</strong></td><td className={p.gain>0?'highlight':'muted'}>{p.gain>0?'+':''}{p.gain}</td><td>{p.status==='a'?<span className="available"><Check size={13}/> FPL available</span>:<span className="caution">{p.news||'Status needs checking'}</span>}</td></tr>)}</tbody></table></div>{!candidates.length&&<Empty text="No replacements pass the current position, club and provisional budget filters."/>}</> }<div className="alert neutral"><ShieldCheck size={20}/>If a GW pick includes a published selling price, that is used; otherwise the current listed price is a provisional substitute. Verify bank, selling value, free transfers and any points hit in official FPL before confirming a move.</div></>:<Empty text="Connect your FPL team to unlock transfer suggestions based on your 15-player squad."/>}</section>}

          {tab===6&&<section><div className="panel"><SectionHead eyebrow="VERIFIABLE HEADLINES" title="Injury & news centre" detail="Latest accessible RSS headlines, timestamps and publisher links. Headlines are not independent injury confirmations."><div className="news-actions"><label className="checkbox"><input type="checkbox" checked={mineOnly} onChange={e=>setMineOnly(e.target.checked)}/> My squad only</label><button className="button-secondary" onClick={()=>void fetchNews()}><RefreshCw size={15}/> Refresh</button></div></SectionHead>{newsError&&<div className="alert neutral"><CircleAlert size={16}/>{newsError}</div>}<div className="news-grid">{relevantNews.map(a=><a className="news-card" href={a.url} target="_blank" rel="noopener noreferrer" key={a.url}><div className="row between"><span className="source-label">{a.source}</span><ArrowUpRight size={16}/></div><h3>{a.title}</h3><p>{a.description}</p><footer><Clock3 size={13}/>{new Date(a.published).getTime()?friendlyTime(a.published):'Date unavailable'}{a.teams.length>0&&<span>· {a.teams.slice(0,3).join(', ')}</span>}</footer></a>)}</div>{!relevantNews.length&&<Empty text={mineOnly?'No headlines currently matched your public squad. Try disabling the squad filter.':'No verified articles are available from the configured feeds right now.'}/>}<p className="footnote">Player associations are possible name matches, not proof that an article concerns a particular FPL asset. Check original articles and official club announcements for confirmation.</p></div></section>}

          {tab===7&&<section className="panel"><SectionHead eyebrow="TRANSPARENT PREDICTION MODEL" title="Gameweek point projections" detail="Estimated totals account for your selected gameweek horizon, blanks, doubles and public FPL availability."><Horizon value={horizon} onChange={setHorizon}/></SectionHead><div className="formula">65% observed season points per match + 35% recent FPL form <span>×</span> minutes factor <span>×</span> FPL availability <span>×</span> opponent fixture factor</div><div className="table-scroll"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>EST. POINTS</th><th>LOW–HIGH</th><th>FIXTURES</th><th>AVG MINS/WEEK</th><th>FPL STATUS</th></tr></thead><tbody>{projections.slice(0,80).map(({player:p,estimate:e},i)=><tr key={p.id}><td>{i+1}</td><td><PlayerName player={p} clubs={clubs}/></td><td className="highlight"><strong>{e.points}</strong></td><td>{e.low}–{e.high}</td><td>{e.fixtureCount}</td><td>{e.minutesPerWeek}</td><td>{p.status==='a'?<span className="available"><Check size={13}/> Available</span>:<span className="caution">{p.news||'Check status'}</span>}</td></tr>)}</tbody></table></div><div className="alert neutral"><CircleHelp size={20}/>Prediction intervals are illustrative and uncalibrated, not statistically guaranteed. xG/xA and reliable line-up probability aren't included unless supplied by a permitted data provider.</div></section>}
        </>}
        <footer className="site-footer"><span>© {new Date().getFullYear()} FPL Intelligence · Independent research platform, not affiliated with the Premier League.</span><span><span className="status-dot"/> Official FPL public data · <a href="https://fantasy.premierleague.com/" target="_blank" rel="noopener noreferrer">Source <ArrowUpRight size={12}/></a></span></footer>
      </div>
    </main>
  </div>;
}