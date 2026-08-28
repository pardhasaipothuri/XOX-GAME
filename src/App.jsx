import React, {useEffect, useMemo, useState} from "react";
import {initializeApp} from "firebase/app";
import {getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, linkWithPopup} from "firebase/auth";
import {getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, collection, query, orderBy, limit, getDocs, serverTimestamp} from "firebase/firestore";

const cfg={
 apiKey:import.meta.env.VITE_FIREBASE_API_KEY, authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
 projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID, storageBucket:import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
 messagingSenderId:import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId:import.meta.env.VITE_FIREBASE_APP_ID
};
let fb=null,auth=null,db=null;
if(cfg.apiKey&&cfg.projectId){fb=initializeApp(cfg);auth=getAuth(fb);db=getFirestore(fb)}

const empty=Array(9).fill(null);
function winner(b){for(const [a,c,d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(b[a]&&b[a]===b[c]&&b[a]===b[d])return b[a];return b.every(Boolean)?"draw":null}
function bestMove(b,me="X"){
 const opp=me==="X"?"O":"X";
 function score(x,turn){const w=winner(x);if(w==="draw")return 0;if(w===me)return 10;if(w===opp)return -10;let vals=[];x.forEach((v,i)=>{if(!v){let y=[...x];y[i]=turn;vals.push(score(y,turn===me?opp:me))}});return turn===me?Math.max(...vals):Math.min(...vals)}
 let best=-Infinity,idx=-1;
 b.forEach((v,i)=>{if(!v){let x=[...b];x[i]=me;let s=score(x,opp);if(s>best){best=s;idx=i}}});return idx
}
function App(){
 const [user,setUser]=useState(null),[name,setName]=useState(""),[board,setBoard]=useState(empty),[turn,setTurn]=useState("X"),[mode,setMode]=useState("menu"),[room,setRoom]=useState(""),[myMark,setMyMark]=useState("X"),[msg,setMsg]=useState(""),[stats,setStats]=useState({wins:0,losses:0,draws:0}),[leaders,setLeaders]=useState([]);
 const gameOver=useMemo(()=>winner(board),[board]);
 useEffect(()=>{if(auth){signInAnonymously(auth).catch(()=>{});return onAuthStateChanged(auth,setUser)}},[]);
 useEffect(()=>{if(!db||!user)return;getDoc(doc(db,"players",user.uid)).then(s=>{if(s.exists()){setName(s.data().name||"");setStats(s.data().stats||stats)}})},[user]);
 useEffect(()=>{if(mode==="online"&&room&&db){return onSnapshot(doc(db,"games",room),s=>{if(s.exists()){let g=s.data();setBoard(g.board||empty);setTurn(g.turn||"X");setMsg(g.status==="waiting"?"Waiting for opponent…":g.status==="done"?g.result:"")}})}},[mode,room]);
 async function saveStats(result){
   if(!db||!user||!name.trim())return;
   let s={...stats}; if(result==="win")s.wins++; if(result==="loss")s.losses++; if(result==="draw")s.draws++;
   setStats(s); await setDoc(doc(db,"players",user.uid),{name:name.trim(),stats:s,updatedAt:serverTimestamp()},{merge:true});
 }
 function reset(){setBoard(empty);setTurn("X");setMsg("")}
 function localMove(i){
   if(gameOver||board[i]||turn!=="X")return;
   let b=[...board];b[i]="X";let w=winner(b);setBoard(b);
   if(w){setMsg(w==="draw"?"Draw!":"You win!");saveStats(w==="X"?"win":"draw");return}
   setTurn("O");setTimeout(()=>{let m=bestMove(b,"O");if(m<0)return;let c=[...b];c[m]="O";let z=winner(c);setBoard(c);setTurn("X");if(z){setMsg(z==="draw"?"Draw!":"Pro Bot wins!");saveStats(z==="O"?"loss":"draw")}},350)
 }
 async function createRoom(){
   if(!db||!user){setMsg("Connect Firebase first.");return}
   let id=Math.random().toString(36).slice(2,8).toUpperCase();setRoom(id);setMyMark("X");setMode("online");
   await setDoc(doc(db,"games",id),{board:empty,turn:"X",status:"waiting",host:user.uid,guest:null,createdAt:serverTimestamp()});
 }
 async function joinRoom(id=room){
   if(!db||!user)return; id=id.trim().toUpperCase(); if(!id)return;
   let ref=doc(db,"games",id),s=await getDoc(ref);if(!s.exists()){setMsg("Game not found.");return}
   let g=s.data(); if(g.guest&&g.guest!==user.uid){setMsg("Room is full.");return}
   setRoom(id);setMyMark("O");setMode("online");await updateDoc(ref,{guest:user.uid,status:"playing"});
 }
 async function onlineMove(i){
   if(!db||!room||gameOver||board[i]||turn!==myMark)return;
   let b=[...board];b[i]=myMark;let w=winner(b);let next=myMark==="X"?"O":"X";
   await updateDoc(doc(db,"games",room),{board:b,turn:next,status:w?"done":"playing",result:w?(w==="draw"?"Draw!":w+" wins!"):null});
 }
 async function loadLeaders(){
   if(!db)return;let q=query(collection(db,"players"),orderBy("stats.wins","desc"),limit(10)),s=await getDocs(q);setLeaders(s.docs.map(d=>({id:d.id,...d.data()})))
 }
 async function google(){
   if(!auth)return;try{if(user?.isAnonymous)await linkWithPopup(user,new GoogleAuthProvider());else await signInWithPopup(auth,new GoogleAuthProvider())}catch(e){setMsg(e.message)}
 }
 const invite=room?`${location.origin}${location.pathname}?room=${room}`:"";
 useEffect(()=>{let r=new URLSearchParams(location.search).get("room");if(r){setRoom(r);setMode("join")}},[]);
 if(mode==="menu")return <main><header><b>✦ XOX ARENA</b><span>{user?"Guest ready":"Offline setup"}</span></header><section className="hero"><h1>Think fast.<br/><em>Place smart.</em></h1><p>Classic XOX with a pro bot and real-time rooms.</p><div className="actions"><button onClick={()=>{reset();setMode("bot")}}>🤖 Play Pro Bot</button><button onClick={()=>setMode("join")}>👥 Play Online</button></div><button className="ghost" onClick={loadLeaders}>🏆 Leaderboard</button>{leaders.length>0&&<div className="leaders">{leaders.map((x,i)=><div key={x.id}><span>#{i+1} {x.name||"Player"}</span><b>{x.stats?.wins||0} wins</b></div>)}</div>}<div className="profile"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Name to save stats"/><button onClick={google}>Save with Google</button></div></section></main>;
 if(mode==="bot")return <Game title="PRO BOT" board={board} turn={turn} over={gameOver} msg={msg} onCell={localMove} onReset={reset} onBack={()=>setMode("menu")} myMark="X"/>;
 if(mode==="join")return <main><header><b>✦ ONLINE</b><button className="back" onClick={()=>setMode("menu")}>← Back</button></header><section className="panel"><h2>Play with a friend</h2><input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Enter game code"/><button onClick={()=>joinRoom()}>Join Room</button><button className="secondary" onClick={createRoom}>Create New Room</button>{msg&&<p className="msg">{msg}</p>}</section></main>;
 return <Game title={`ROOM ${room}`} board={board} turn={turn} over={gameOver} msg={msg||"Share the code or link"} onCell={onlineMove} onReset={reset} onBack={()=>setMode("menu")} myMark={myMark} invite={invite}/>;
}
function Game({title,board,turn,over,msg,onCell,onReset,onBack,myMark,invite}){return <main><header><b>✦ {title}</b><button className="back" onClick={onBack}>← Exit</button></header><section className="game"><div className="status">{over?<strong>{msg}</strong>:<span>Your mark: <b>{myMark}</b> · Turn: <b>{turn}</b></span>}</div><div className="board">{board.map((v,i)=><button key={i} onClick={()=>onCell(i)} disabled={!!v||!!over}>{v}</button>)}</div>{invite&&<div className="invite"><small>Invite link</small><input readOnly value={invite}/><button onClick={()=>navigator.clipboard?.writeText(invite)}>Copy</button></div>}<button className="secondary" onClick={onReset}>↻ New Game</button></section></main>}
export default App;
