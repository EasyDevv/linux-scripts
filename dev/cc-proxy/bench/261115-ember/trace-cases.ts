// Program-tracing cases (261115 round 2b): predict what a JS program prints without running it.
// Spec-driven code tasks hit the ceiling even at `low` (harder-cases.ts: 16/16 at low and max), so this
// set needs the model to simulate execution: closures, microtask order, generators, regex state, long
// arithmetic loops, grid simulation. Expected output comes from running each program in node.
import { spawnSync } from "node:child_process";

export type TraceCase = { id: string; program: string; expected: string[] };

const programs: Record<string, string> = {
	closures: `var fs=[];for(var i=0;i<3;i++){fs.push(()=>i)}
let gs=[];for(let j=0;j<3;j++){gs.push(()=>j)}
console.log(fs.map(f=>f()).join(","), gs.map(g=>g()).join(","));`,
	sort: `const a=[10,9,1,100,25,"b","B",-3];a.sort();console.log(JSON.stringify(a));
console.log([3,1,2].sort((x,y)=>y-x).concat([0]).reverse().join(""));`,
	lcg: `let x=12345,s=0;for(let k=0;k<40;k++){x=(x*75+74)%65537;if(x%3===0)s+=k;else if(x%3===1)s-=1;}console.log(x,s);`,
	bits: `let v=0;for(let i=1;i<=20;i++){v=((v<<3)^(i*i))&0xffff;if(v&1)v=v>>>1;}console.log(v,(v|0).toString(2).length,~v);`,
	collatz: `const memo=new Map();function c(n){if(n===1)return 0;if(memo.has(n))return memo.get(n);const r=1+(n%2?c(3*n+1):c(n/2));memo.set(n,r);return r}
let best=[0,0];for(let n=1;n<=30;n++){const s=c(n);if(s>best[1])best=[n,s]}console.log(best.join(":"),c(97));`,
	strings: `const s="The quick brown fox jumps over the lazy dog";
const w=s.split(" ").map((t,i)=>i%2?t.split("").reverse().join(""):t.toUpperCase());
console.log(w.join("-"));console.log([...new Set(s.toLowerCase().replace(/[^a-z]/g,""))].slice(-5).join(""));`,
	microtasks: `console.log("a");setTimeout(()=>console.log("b"),0);Promise.resolve().then(()=>console.log("c")).then(()=>console.log("d"));queueMicrotask(()=>console.log("e"));(async()=>{console.log("f");await null;console.log("g")})();console.log("h");`,
	labels: `let out=[];outer:for(let i=0;i<4;i++){for(let j=0;j<4;j++){if(j===i)continue outer;if(i+j===5)break outer;switch((i*j)%3){case 0:out.push("z");case 1:out.push("o");break;default:out.push("t")}}}console.log(out.join(""));`,
	floats: `console.log(0.1+0.2===0.3,(0.1+0.2).toFixed(20).slice(0,8),[0.5,1.5,2.5,-0.5].map(Math.round).join(","),(1.005).toFixed(2),Number.MAX_SAFE_INTEGER+2);`,
	holes: `const a=[1,,3];a[6]=7;console.log(a.length,a.filter(()=>true).length,a.map(x=>x*2).join("|"),Object.keys(a).join(","),a.indexOf(undefined));`,
	classes: `class A{constructor(){this.n=1}inc(){this.n+=this.step??2;return this}get twice(){return this.n*2}}class B extends A{constructor(){super();this.step=5}inc(){super.inc();this.n*=3;return this}}const b=new B();b.inc().inc();console.log(b.n,b.twice,Object.keys(b).join(","));`,
	robot: `let x=0,y=0,d=0;const seen=new Set(["0,0"]);const prog="FFRFFLFRRFLF";for(let r=0;r<7;r++)for(const c of prog){if(c==="R")d=(d+1)%4;else if(c==="L")d=(d+3)%4;else{x+=[0,1,0,-1][d];y+=[1,0,-1,0][d];seen.add(x+","+y)}}console.log(x,y,d,seen.size);`,
	grouping: `const p=[["ann",3],["bob",1],["cat",3],["dan",2],["eve",1],["fay",2],["gus",3]];const g=p.reduce((m,[n,s])=>{(m[s]??=[]).push(n);return m},{});console.log(JSON.stringify(g));console.log(p.slice().sort((a,b)=>b[1]-a[1]).map(x=>x[0][0]).join(""));`,
	sumloop: `let t=0;for(let i=1;i<=200;i++){if(i%7===0||String(i).includes("3"))continue;t+=i%11===0?i*2:i}console.log(t);`,
	generator: `function* g(){let a=0,b=1;while(true){const r=yield a;if(r)[a,b]=[0,1];else[a,b]=[b,a+b]}}const it=g();const o=[];for(let i=0;i<12;i++)o.push(it.next(i===7).value);console.log(o.join(","));`,
	lcg2: `let a=7,b=3,o=[];for(let k=1;k<=25;k++){[a,b]=[(a*31+b)%1009,(b*17+k)%101];if(k%5===0)o.push(a^b)}console.log(o.join(","));`,
	editdist: `function ed(s,t){const d=Array.from({length:s.length+1},(_,i)=>[i,...Array(t.length).fill(0)]);for(let j=1;j<=t.length;j++)d[0][j]=j;for(let i=1;i<=s.length;i++)for(let j=1;j<=t.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(s[i-1]===t[j-1]?0:1));return d[s.length][t.length]}console.log(ed("kitten","sitting"),ed("intention","execution"),ed("abcdef","azced"),ed("sunday","saturday"));`,
	josephus: `function j(n,k){const a=Array.from({length:n},(_,i)=>i+1);const out=[];let i=0;while(a.length){i=(i+k-1)%a.length;out.push(a.splice(i,1)[0])}return out}console.log(j(10,3).join(","));console.log(j(13,5).slice(-3).join(","));`,
	bubble: `const a=[5,1,4,2,8,0,2,9,3,7];let swaps=0,passes=0;for(let n=a.length;n>1;n--){let any=false;passes++;for(let i=0;i<n-1;i++)if(a[i]>a[i+1]){[a[i],a[i+1]]=[a[i+1],a[i]];swaps++;any=true}if(!any)break}console.log(swaps,passes,a.join(""));`,
	matpow: `function mul(A,B,m){return A.map((r,i)=>B[0].map((_,j)=>r.reduce((s,_,k)=>(s+A[i][k]*B[k][j])%m,0)))}let R=[[1,0],[0,1]],M=[[1,1],[1,0]];let e=37;while(e){if(e&1)R=mul(R,M,1000);M=mul(M,M,1000);e>>=1}console.log(R[0][1],R[0][0]);`,
	sieve: `const N=150,p=Array(N+1).fill(true);p[0]=p[1]=false;for(let i=2;i*i<=N;i++)if(p[i])for(let j=i*i;j<=N;j+=i)p[j]=false;const ps=p.flatMap((v,i)=>v?[i]:[]);console.log(ps.length,ps.filter(x=>x%10===3).reduce((a,b)=>a+b,0),ps.at(-1));`,
	rle: `const s="aaabccddddeaaabbbbbbc";let r="";for(let i=0;i<s.length;){let j=i;while(j<s.length&&s[j]===s[i])j++;r+=(j-i>2?(j-i)+s[i]:s.slice(i,j));i=j}console.log(r,r.length);console.log(s.split("").reduce((m,c)=>(m[c]=(m[c]||0)+1,m),{}).b);`,
	dates: `const d=new Date(Date.UTC(2024,0,31));const out=[];for(let i=0;i<4;i++){d.setUTCMonth(d.getUTCMonth()+1);out.push(d.toISOString().slice(0,10))}console.log(out.join(" "));console.log(new Date(Date.UTC(2026,1,29)).getUTCDate(),new Date(Date.UTC(2026,0,1)).getUTCDay());`,
	regexstate: `const re=/a\\d/g;const r=[];for(const s of ["a1","a2","xa3","a4"])r.push(re.test(s));console.log(r.join(","),re.lastIndex,"a1a2a3".replace(/a(\\d)/g,(m,d,o)=>d*o));`,
};

export const traces: TraceCase[] = Object.entries(programs).map(([id, program]) => {
	const run = spawnSync("node", ["-e", program], { encoding: "utf8", timeout: 5000 });
	if (run.status !== 0) throw new Error(`${id}: ${run.stderr}`);
	return { id, program, expected: run.stdout.replace(/\n$/, "").split("\n") };
});

/** Lines in the right position count; extra or missing lines count against. 100 only when identical. */
export function traceQuality(actual: unknown, expected: string[]): number {
	const lines = actual && typeof actual === "object" && Array.isArray((actual as any).lines) ? ((actual as any).lines as unknown[]) : null;
	if (!lines) return 0;
	const hits = expected.filter((line, i) => lines[i] === line).length;
	return Math.round((10000 * hits) / Math.max(expected.length, lines.length)) / 100;
}
