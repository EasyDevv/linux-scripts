export interface Case {
  id: string;
  spec: string;
  files: Record<string, string>;
  tests: Array<{ input: unknown; expected: unknown }>;
  requiredPatterns?: Record<string, string[]>;
}
export const workers: Case[] = [
  { id: "unique", spec: "Implement solve(input): trim string items, drop empty strings, case-sensitive deduplicate preserving first occurrence. Never mutate input.", files: { "main.cjs": "exports.solve = input => input;\n" }, tests: [
    { input: [" a ", "b", "a", "", " B "], expected: ["a", "b", "B"] }, { input: [], expected: [] }, { input: [" ", "x", "x"], expected: ["x"] },
  ] },
  { id: "pagination", spec: "Implement solve({items,page,size}): return {items,total,pages}. size is positive integer; page is 1-based; clamp page below 1 to 1; out-of-range page gives empty items; pages=ceil(total/size), including zero for empty input. Never mutate input.", files: { "main.cjs": "exports.solve = ({items}) => ({items});\n" }, tests: [
    { input: { items: [1,2,3,4,5], page: 2, size: 2 }, expected: { items: [3,4], total: 5, pages: 3 } },
    { input: { items: [], page: 1, size: 3 }, expected: { items: [], total: 0, pages: 0 } },
    { input: { items: [1], page: 0, size: 2 }, expected: { items: [1], total: 1, pages: 1 } },
    { input: { items: [1], page: 3, size: 2 }, expected: { items: [], total: 1, pages: 1 } },
  ] },
  { id: "aggregate", spec: "Implement sumBy in totals.cjs and solve in main.cjs. solve(rows) returns sorted ascending [{team,total}]. Include only rows whose active is true, sum amount per team including negative numbers. main.cjs must call imported sumBy(rows) from totals.cjs. Never mutate input.", files: { "main.cjs": "const {sumBy}=require('./totals.cjs'); exports.solve=rows=>sumBy(rows);\n", "totals.cjs": "exports.sumBy = rows => [];\n" }, requiredPatterns: { "main.cjs": ["require\\(['\\\"]\\./totals\\.cjs['\\\"]\\)", "sumBy\\("], "totals.cjs": ["exports\\.sumBy\\s*="] }, tests: [
    { input: [{team:"b",amount:5,active:true},{team:"a",amount:3,active:true},{team:"b",amount:-2,active:true},{team:"a",amount:99,active:false}], expected: [{team:"a",total:3},{team:"b",total:3}] }, {input: [], expected: []},
  ] },
  { id: "inventory", spec: "Implement apply in stock.cjs and solve in main.cjs. Input {stock: Record<string,number>, events: Array<{sku:string,delta:number}>}; process events in order using each event.delta. Delta causing negative stock is rejected; unknown sku starts at 0. Return {stock,rejected} where rejected is zero-based event indexes. main.cjs must import apply from stock.cjs. Never mutate input.", files: { "main.cjs": "const {apply}=require('./stock.cjs');exports.solve=x=>apply(x);\n", "stock.cjs": "exports.apply=x=>x;\n" }, requiredPatterns: { "main.cjs": ["require\\(['\\\"]\\./stock\\.cjs['\\\"]\\)", "apply\\("], "stock.cjs": ["exports\\.apply\\s*="] }, tests: [
    { input: {stock:{a:2}, events:[{sku:"a",delta:-3},{sku:"a",delta:1},{sku:"b",delta:4},{sku:"b",delta:-4}]}, expected:{stock:{a:3,b:0},rejected:[0]} },
    {input:{stock:{},events:[{sku:"z",delta:-1}]},expected:{stock:{},rejected:[0]}}, {input:{stock:{a:1},events:[]},expected:{stock:{a:1},rejected:[]}},
  ] },
  { id: "expiry", spec: "Implement solve({now,until,reset,used,aborted}). Return null on aborted. Otherwise expiry=max(now,until,reset only when used>=100 and reset>now), capped at now+691200. now/until/reset are epoch seconds. Never mutate input.", files:{"main.cjs":"exports.solve=x=>x.until;\n"}, tests:[
    {input:{now:1000,until:1900,reset:30000,used:100,aborted:false},expected:30000}, {input:{now:1000,until:1900,reset:30000,used:99,aborted:false},expected:1900},
    {input:{now:1000,until:900,reset:950,used:100,aborted:false},expected:1000}, {input:{now:1000,until:1900,reset:9000000,used:100,aborted:false},expected:692200}, {input:{now:1000,until:1900,reset:30000,used:100,aborted:true},expected:null},
  ] },
  { id: "selection", spec: "Implement solve({candidates,unavailable,abort}) returning first candidate not in unavailable, or null. Preserve supplied priority (do not sort). If abort true return null. Unavailable entries are exact model IDs, not provider prefixes. Never mutate input.",files:{"main.cjs":"exports.solve=x=>x.candidates[0];\n"},tests:[
    {input:{candidates:["p/a","p/b","q/c"],unavailable:["p/a"],abort:false},expected:"p/b"}, {input:{candidates:["p/b","p/a"],unavailable:[],abort:false},expected:"p/b"},
    {input:{candidates:["p/a"],unavailable:["p/a"],abort:false},expected:null}, {input:{candidates:["p/a"],unavailable:[],abort:true},expected:null}, {input:{candidates:[],unavailable:[],abort:false},expected:null},
  ] },
];

export interface StructuredCase { id: string; prompt: string; expected: Record<string, unknown>; }

export const reads: StructuredCase[] = [
  {
    id: "read-import-flow",
    prompt: "Read the snippets and output ONLY JSON with exactly keys entry, importedAs, implementation, argument, result. entry=exported entry function name; importedAs=local alias; implementation=original imported symbol; argument=exact string value passed (preserve spaces, omit source quotes); result=evaluated return string.\n// app.ts\nimport { normalize as clean } from './text'; export const start = () => clean('  Pi  ');\n// text.ts\nexport const normalize = (value: string) => value.trim().toLowerCase();\n// old.ts\nexport const normalize = () => 'unused';",
    expected: { entry: "start", importedAs: "clean", implementation: "normalize", argument: "  Pi  ", result: "pi" },
  },
  {
    id: "read-config-precedence",
    prompt: "Read the config resolver and output ONLY JSON with exactly keys canonicalPath, legacyPath, winner, mergedRetries. canonicalPath=exact literal 'workloads.offload.profileByTool.bulk_read' without a source variable prefix; legacyPath=exact literal 'offload.grade' without a source variable prefix; winner=resolved bulk_read profile string; mergedRetries=resolved number.\nconst legacy={offload:{grade:'old',retries:2}}; const modern={workloads:{offload:{profileByTool:{bulk_read:'read'}}}};\nconst section=modern.workloads?.offload ?? legacy.offload; const winner=section.profileByTool?.bulk_read ?? section.grade;\nconst mergedRetries=section.retries ?? legacy.offload.retries ?? 0;",
    expected: { canonicalPath: "workloads.offload.profileByTool.bulk_read", legacyPath: "offload.grade", winner: "read", mergedRetries: 2 },
  },
  {
    id: "read-error-policy",
    prompt: "Trace this policy and output ONLY JSON with exactly keys overflow, retryable, cancelSibling, reason. reason must be the supplied error category string only.\nconst overflow=isContextOverflow(error); const retryable=isRetryableAssistantError(error);\nconst cancelSibling=!overflow&&!retryable&&sameProviderQuotaKey;\nInput: error category='context overflow'; isContextOverflow=true; isRetryableAssistantError=false; sameProviderQuotaKey=true.",
    expected: { overflow: true, retryable: false, cancelSibling: false, reason: "context overflow" },
  },
  {
    id: "read-timeout",
    prompt: "Trace the values and output ONLY JSON with exactly keys requested, defaulted, capped, effective.\nconst requested=900; const defaulted=requested??120; const capped=Math.min(defaulted,600); const effective=capped;",
    expected: { requested: 900, defaulted: 900, capped: 600, effective: 600 },
  },
  {
    id: "read-route-order",
    prompt: "Trace first-match routing and output ONLY JSON with exactly keys model, firstPattern, selected, fallbackUsed. firstPattern=the exact match string of the first matching route; selected=that route's to value.\nroutes=[{match:'commandcode/*',to:'codex'},{match:'commandcode/Qwen/*',to:'qwen'}]; defaultRoute='grok-build'; model='commandcode/Qwen/Qwen3.8-Flash'; routes are evaluated in array order.",
    expected: { model: "commandcode/Qwen/Qwen3.8-Flash", firstPattern: "commandcode/*", selected: "codex", fallbackUsed: false },
  },
  {
    id: "read-state-machine",
    prompt: "Apply the transitions and output ONLY JSON with exactly keys initial, afterStart, afterFailure, completionAllowed. State strings must use pending/in_progress/completed exactly. completionAllowed is boolean.\nAllowed: pending->in_progress->completed. A failed verification keeps the task in_progress. Initial state pending; start work; verification fails.",
    expected: { initial: "pending", afterStart: "in_progress", afterFailure: "in_progress", completionAllowed: false },
  },
];

export const summaries: StructuredCase[] = [
  {
    id: "summary-schema-migration",
    prompt: "Summarize as ONLY JSON with exactly keys changed, legacy, verified, unresolved, next. changed must be exact literal 'models.profiles'; legacy must be exact literal 'grades'; preserve the verification count phrase exactly; unresolved is the unavailable check phrase only; next is the imperative action without 'action is'.\nUser requested models.profiles to replace grades with legacy reads retained. Assistant updated parsers and docs. Tool: 360 tests passed. Check: LSP unavailable. Next: restart Pi.",
    expected: { changed: "models.profiles", legacy: "grades", verified: "360 tests passed", unresolved: "LSP unavailable", next: "restart Pi" },
  },
  {
    id: "summary-failed-fix",
    prompt: "Summarize as ONLY JSON with exactly keys file, attempts, failingCheck, status, forbiddenClaim. attempts is a number; status uses pending/in_progress/completed; forbiddenClaim is the prohibited status token.\nChanged src/auth.ts. Attempts: 2. Failing check: integration-auth. Keep status in_progress; forbidden claim: completed.",
    expected: { file: "src/auth.ts", attempts: 2, failingCheck: "integration-auth", status: "in_progress", forbiddenClaim: "completed" },
  },
  {
    id: "summary-benchmark",
    prompt: "Summarize as ONLY JSON with exactly keys winner, reliability, workerMedianSeconds, loserIssue, sampleWarning. workerMedianSeconds is a number; use the exact short phrases supplied for other fields.\nWinner: Qwen. Reliability: 6/6. Winner worker median seconds: 11.63. Loser issue: upstream 503. Sample warning: not a population estimate.",
    expected: { winner: "Qwen", reliability: "6/6", workerMedianSeconds: 11.63, loserIssue: "upstream 503", sampleWarning: "not a population estimate" },
  },
  {
    id: "summary-permissions",
    prompt: "Summarize as ONLY JSON with exactly keys allowedRead, allowedWrite, network, subprocess, scope. allowedRead and scope are the exact noun phrases supplied; the three permissions are booleans.\nAllowed read: case directory. Allowed write: false. Network: false. Subprocess: false. Scope: grader process.",
    expected: { allowedRead: "case directory", allowedWrite: false, network: false, subprocess: false, scope: "grader process" },
  },
  {
    id: "summary-priority",
    prompt: "Summarize as ONLY JSON with exactly keys canonical, fallback, precedence, removed. Paths must be exact; precedence is the winning side token only.\nCanonical: workloads.offload.profileByTool.bulk_read. Fallback: offload.bulkReadGrade. Precedence: canonical. Removed: offload.grade.",
    expected: { canonical: "workloads.offload.profileByTool.bulk_read", fallback: "offload.bulkReadGrade", precedence: "canonical", removed: "offload.grade" },
  },
  {
    id: "summary-handoff",
    prompt: "Summarize as ONLY JSON with exactly keys done, passing, blocked, owner, push. done and blocked are exact noun phrases; passing is an array of suite names; push is boolean.\nDone: parser migration. Passing suites: unit, integration. Blocked: live GLM run. Owner: Mina. Push: false.",
    expected: { done: "parser migration", passing: ["unit", "integration"], blocked: "live GLM run", owner: "Mina", push: false },
  },
];
