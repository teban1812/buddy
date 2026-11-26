// Buddy's program is found by this small Node program, run as `node -e SCRIPT json|open [antigravity]` in the project's folder (Node is what Buddy needs anyway, so macOS, Linux and Windows run the same code): this
// project's own core/bin/buddy.mjs when it has one, else the Buddy installed in the panel's own tool, else the one installed in the other tool (R284), so the
// short view and the page come from the same Buddy as the conversation. Claude Code's Buddy is the highest version in <Claude Code's folder>/plugins/cache/<catalogue>/buddy/<version>/bin/buddy.mjs
// (CLAUDE_CONFIG_DIR moves the folder); Antigravity's is where `agy plugin install` puts it, ~/.gemini/config/plugins/buddy/bin/buddy.mjs. Claude Code's panel
// looks in its own first; Antigravity's passes `antigravity` and looks in its own first. The project is the nearest folder holding docs/buddy, going up from
// the folder it runs in (the conversation's folder may have moved into one inside the project, such as docs/buddy/milestones: R287), and everything below runs
// there; a project inside another is itself. It answers 3 when no folder up to the root holds docs/buddy and 4 when no program is found. `json` prints the board; `open` writes its full page to .buddy/board.html (local,
// ignored by git) and opens it in the browser (open on macOS, start on Windows, xdg-open elsewhere). Windows is written but not tried on one.
// `language` prints the person's language from Buddy's setting of the machine ($BUDDY_HOME or ~/.buddy/environment.json, key `language`), empty when unset or
// unreadable: a small read of the file instead of running `buddy tools` (which asks the tools for their models and is slow), and it works in any folder.
export const SCRIPT = [
  "const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');",
  "if(process.argv[1]==='language'){let l='';try{l=JSON.parse(fs.readFileSync(path.join(process.env.BUDDY_HOME||path.join(os.homedir(),'.buddy'),'environment.json'),'utf8')).language||''}catch(e){}console.log(l);process.exit(0)}",
  "{let d=process.cwd();while(!fs.existsSync(path.join(d,'docs','buddy'))){const u=path.dirname(d);if(u===d)process.exit(3);d=u}process.chdir(d)}",
  "let p=path.join('core','bin','buddy.mjs');",
  'if(!fs.existsSync(p)){',
  "const base=path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'plugins','cache');",
  'const ls=d=>{try{return fs.readdirSync(d)}catch(e){return[]}};',
  "const num=v=>v.split(/[.+-]/).map(n=>parseInt(n,10)||0);",
  'const cmp=(a,b)=>{const x=num(a.v),y=num(b.v);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d}return 0};',
  'const found=[];',
  "for(const m of ls(base))for(const v of ls(path.join(base,m,'buddy'))){const f=path.join(base,m,'buddy',v,'bin','buddy.mjs');if(fs.existsSync(f))found.push({v,f})}",
  "found.sort(cmp);const claude=found.length?found[found.length-1].f:'';",
  "const agy=path.join(os.homedir(),'.gemini','config','plugins','buddy','bin','buddy.mjs'),ag=fs.existsSync(agy)?agy:'';",
  "p=process.argv[2]==='antigravity'?ag||claude:claude||ag}",
  'if(!p)process.exit(4);',
  "if(process.argv[1]==='open'){",
  "fs.mkdirSync('.buddy',{recursive:true});const out=path.resolve('.buddy','board.html');",
  "let r=cp.spawnSync(process.execPath,[p,'board','--out',out],{stdio:'ignore'});if(r.status!==0)process.exit(5);",
  "const o=process.platform==='darwin'?['open',[out]]:process.platform==='win32'?['cmd',['/c','start','',out]]:['xdg-open',[out]];",
  "r=cp.spawnSync(o[0],o[1],{stdio:'ignore'});process.exit(r.status===0?0:6)}",
  "const r=cp.spawnSync(process.execPath,[p,'board','--json'],{stdio:['ignore','inherit','inherit'],maxBuffer:1<<28});process.exit(r.status===null?1:r.status)",
].join('')
