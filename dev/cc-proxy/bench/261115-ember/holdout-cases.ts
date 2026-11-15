// Holdout program-tracing cases (261115 round 4): written after trace-cases.ts showed deepseek-v4.1-flash
// ahead of Muse Ember, to check that the gap is not an artefact of that one set. Same format and scoring
// (traceQuality); none of these programs was seen by any model before the run. Expected output from node.
import { spawnSync } from "node:child_process";
import type { TraceCase } from "./trace-cases.ts";

const programs: Record<string, string> = {
	reduceright: `const a=[1,2,3,4,5];console.log(a.reduceRight((acc,x,i)=>acc*2+x*i,1),a.reduce((p,c)=>p-c));`,
	spreadobj: `const o={a:1,b:2};const p={...o,a:3,c:o.a+o.b};const {a,...rest}=p;o.a=9;console.log(a,JSON.stringify(rest),Object.entries(p).flat().join(""));`,
	asyncorder: `const log=[];const p=new Promise(r=>{log.push(1);r(2)});setTimeout(()=>log.push(3));p.then(v=>{log.push(v);return Promise.resolve(4)}).then(v=>log.push(v));Promise.resolve().then(()=>log.push(5)).then(()=>log.push(6)).then(()=>log.push(7));log.push(8);setTimeout(()=>console.log(log.join("")),5);`,
	knapsack: `const w=[3,4,5,9,4],v=[3,4,4,10,4],C=11;const dp=Array(C+1).fill(0);for(let i=0;i<w.length;i++)for(let c=C;c>=w[i];c--)dp[c]=Math.max(dp[c],dp[c-w[i]]+v[i]);console.log(dp.join(","));`,
	baseconv: `let n=2026,o=[];for(const b of [2,3,7,16,36])o.push(n.toString(b));console.log(o.join(" "),parseInt("zz",36)+parseInt("0x1f"),parseInt("12px"),Number("12px"));`,
	xorshift: `let s=2463534242>>>0,o=[];for(let i=0;i<6;i++){s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;o.push(s%100)}console.log(o.join(","));`,
	stackvm: `const prog="3 4 + 2 * 7 - dup * 5 swap - 2 /".split(" ");const st=[];for(const t of prog){if(/^\\d+$/.test(t))st.push(+t);else if(t==="dup")st.push(st.at(-1));else if(t==="swap"){const a=st.pop(),b=st.pop();st.push(a,b)}else{const b=st.pop(),a=st.pop();st.push(t==="+"?a+b:t==="-"?a-b:t==="*"?a*b:a/b)}}console.log(st.join(","));`,
	life: `let g=new Set(["1,0","2,1","0,2","1,2","2,2","4,4","4,5","4,3"]);const N=8;for(let t=0;t<4;t++){const c=new Map();for(const k of g){const[x,y]=k.split(",").map(Number);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy)continue;const key=((x+dx+N)%N)+","+((y+dy+N)%N);c.set(key,(c.get(key)||0)+1)}}g=new Set([...c].filter(([k,n])=>n===3||(n===2&&g.has(k))).map(([k])=>k))}console.log(g.size,[...g].map(k=>k.split(",").map(Number)).reduce((a,[x,y])=>a+x*10+y,0));`,
	proxy: `let calls=0;const p=new Proxy({x:1},{get(t,k){calls++;return k in t?t[k]*10:k.length}});console.log(p.x+p.hello,calls,"x" in p,JSON.stringify(p));`,
	stablesort: `const r=[["d",2],["a",1],["c",2],["b",1],["e",3],["f",1]];r.sort((x,y)=>x[1]-y[1]);console.log(r.map(x=>x[0]).join(""));r.sort((x,y)=>y[0]<x[0]?-1:1);console.log(r.map(x=>x[0]).join(""),[..."hello"].sort().reverse().join(""));`,
	dijkstra: `const E=[[0,1,4],[0,2,1],[2,1,2],[1,3,1],[2,3,5],[3,4,3],[1,4,8],[4,5,1],[3,5,7]];const n=6,d=Array(n).fill(Infinity),pr=Array(n).fill(-1),done=Array(n).fill(false);d[0]=0;for(let it=0;it<n;it++){let u=-1;for(let i=0;i<n;i++)if(!done[i]&&(u<0||d[i]<d[u]))u=i;done[u]=true;for(const[a,b,w]of E)for(const[x,y]of[[a,b],[b,a]])if(x===u&&d[u]+w<d[y]){d[y]=d[u]+w;pr[y]=u}}const path=[];for(let v=5;v>=0;v=pr[v])path.unshift(v);console.log(d.join(","),path.join(">"));`,
	mississippi: `const s="Mississippi";console.log(s.replaceAll("ss","S").split("i").length,s.lastIndexOf("ss"),s.slice(-4,-1),s.substring(5,2),[...s].filter((c,i,a)=>a.indexOf(c)===i).join(""));`,
	typed: `const a=new Uint8Array([250,5,128]);a[0]+=10;a[1]-=6;const b=new Int8Array(a.buffer);console.log(a.join(","),b.join(","),new Uint16Array(new Uint8Array([1,2,3,4]).buffer).join(","));`,
	memo: `const f=(n,m={})=>n<2?n:m[n]??=f(n-1,m)+f(n-2,m)*2;console.log([5,10,20].map(n=>f(n)).join(","));`,
	dateweek: `const d=new Date(Date.UTC(2026,11,31));const out=[];for(let i=0;i<5;i++){d.setUTCDate(d.getUTCDate()+45);out.push(d.getUTCDay()+":"+d.toISOString().slice(5,10))}console.log(out.join(" "));`,
	bigint: `let a=1n;for(let i=1n;i<=25n;i++)a*=i;console.log(a%1000003n,String(a).length,(2n**64n-1n).toString(16),7n/2n,-7n/2n);`,
	digitprod: `let n=987654321,steps=0;while(n>9){n=String(n).split("").reduce((p,c)=>p*(+c||1),1);steps++}console.log(n,steps);`,
};

export const holdout: TraceCase[] = Object.entries(programs).map(([id, program]) => {
	const run = spawnSync("node", ["-e", program], { encoding: "utf8", timeout: 5000 });
	if (run.status !== 0) throw new Error(`${id}: ${run.stderr}`);
	return { id, program, expected: run.stdout.replace(/\n$/, "").split("\n") };
});
