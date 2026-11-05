const fs=require('fs'),path=require('path'),vm=require('vm');
module.exports=function(){
  const dir=path.join(__dirname,'../src');
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js')&&!f.startsWith("9")).sort();
  const code=files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n')+
   '\n;({CONFIG,TERRAIN_ID,Hex,Grid,MapGen,Engine: typeof Engine!=="undefined"?Engine:null, Scenario: typeof Scenario!=="undefined"?Scenario:null, SaveSystem: typeof SaveSystem!=="undefined"?SaveSystem:null, Intel, Combat, Scenario, Transport, Loot, Logistics, Politics, Field, Recruit, Foreign, Mines, Air: typeof Air!=="undefined"?Air:null, AI: typeof AI!=="undefined"?AI:null})';
  const ctx=vm.createContext({console,Math,JSON,Date});
  const r=vm.runInContext(code,ctx);
  return r;
};
