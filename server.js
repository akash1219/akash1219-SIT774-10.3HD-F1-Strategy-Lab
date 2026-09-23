const express = require('express');
const logger = require('morgan');
const path = require('path');
const { db } = require('./db');
const { syncSeason } = require('./sync-data');

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.use(logger('dev'));
app.use(express.json({limit:'200kb'}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

const allowedQueryTypes=['general','drivers','teams','races','feedback'];
const compounds=['SOFT','MEDIUM','HARD'];
const int=(v,min,max)=>Number.isInteger(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;
const num=(v,min,max)=>Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):null;

app.get('/api/health',(req,res)=>res.json({status:'OK',database:'connected',message:'Formula 1 World server is running'}));

// Existing Task 10.2 contact-query CRUD, preserved.
app.get('/api/queries',(req,res)=>{try{res.json(db.prepare(`SELECT id,name,email,phone,query_type,message,created_at FROM queries ORDER BY id DESC`).all());}catch(e){res.status(500).json({error:'Unable to retrieve queries'});}});
app.post('/api/queries',(req,res)=>{try{const{name,email,phone,queryType,message}=req.body;const n=String(name||'').trim(),e=String(email||'').trim(),p=String(phone||'').trim(),q=String(queryType||'').trim(),m=String(message||'').trim();if(!n||!e||!p||!q||!m)return res.status(400).json({error:'All fields are required'});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))return res.status(400).json({error:'Please enter a valid email address'});if(!/^\d{10}$/.test(p))return res.status(400).json({error:'Phone number must contain exactly 10 digits'});if(!allowedQueryTypes.includes(q))return res.status(400).json({error:'Invalid query type'});const r=db.prepare(`INSERT INTO queries(name,email,phone,query_type,message) VALUES(?,?,?,?,?)`).run(n,e,p,q,m);res.status(201).json({message:'Query submitted successfully',id:Number(r.lastInsertRowid)});}catch(err){res.status(500).json({error:'Unable to save query'});}});
app.put('/api/queries/:id',(req,res)=>{try{const id=int(req.params.id,1,1e9);if(!id)return res.status(400).json({error:'Invalid query ID'});const{name,email,phone,queryType,message}=req.body;const n=String(name||'').trim(),e=String(email||'').trim(),p=String(phone||'').trim(),q=String(queryType||'').trim(),m=String(message||'').trim();if(!n||!e||!p||!q||!m)return res.status(400).json({error:'All fields are required'});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)||!/^\d{10}$/.test(p)||!allowedQueryTypes.includes(q))return res.status(400).json({error:'Invalid query data'});if(!db.prepare(`SELECT id FROM queries WHERE id=?`).get(id))return res.status(404).json({error:'Query not found'});db.prepare(`UPDATE queries SET name=?,email=?,phone=?,query_type=?,message=? WHERE id=?`).run(n,e,p,q,m,id);res.json({message:'Query updated successfully'});}catch(err){res.status(500).json({error:'Unable to update query'});}});
app.delete('/api/queries/:id',(req,res)=>{try{const id=int(req.params.id,1,1e9);if(!id)return res.status(400).json({error:'Invalid query ID'});if(!db.prepare(`SELECT id FROM queries WHERE id=?`).get(id))return res.status(404).json({error:'Query not found'});db.prepare(`DELETE FROM queries WHERE id=?`).run(id);res.json({message:'Query deleted successfully'});}catch(err){res.status(500).json({error:'Unable to delete query'});}});

// Database-backed catalog. Season/race filtering is performed in SQLite.
app.get('/api/strategy/catalog',(req,res)=>{try{
  const requestedSeason=req.query.season?int(req.query.season,1950,2100):null;
  const requestedRaceId=req.query.raceId?int(req.query.raceId,1,1e9):null;

  const seasons=db.prepare(`
    SELECT year,source_label
    FROM seasons
    WHERE year IN (2024,2025)
    ORDER BY year
  `).all();

  const season=requestedSeason||Number(seasons[0]?.year||2024);

  const races=db.prepare(`
    SELECT id,season_year,round,name,circuit_name,country,race_date,
           provider,provider_id,source_updated_at,imported_at
    FROM races
    WHERE season_year=?
    ORDER BY round
  `).all(season);

  let drivers;

  if(requestedRaceId){
    const race=db.prepare(`SELECT id,season_year FROM races WHERE id=?`).get(requestedRaceId);
    if(!race||Number(race.season_year)!==season){
      return res.status(400).json({error:'Selected race does not belong to the selected season'});
    }

    // Prefer the pinned F1DB result set when it exists for this race.
    // Older Jolpica rows remain stored, but are not mixed into the selector.
    const hasF1dbResults=Boolean(
      db.prepare(`
        SELECT 1
        FROM race_results
        WHERE race_id=? AND provider='f1db'
        LIMIT 1
      `).get(requestedRaceId)
    );

    const preferredProvider=hasF1dbResults?'f1db':null;

    drivers=db.prepare(`
      SELECT DISTINCT
        d.id,d.given_name,d.family_name,d.code,d.permanent_number,
        d.provider,d.provider_id,
        r.season_year,
        t.id AS team_id,
        t.name AS team_name,
        rr.provider AS result_provider
      FROM race_results rr
      JOIN races r ON r.id=rr.race_id
      JOIN drivers d ON d.id=rr.driver_id
      LEFT JOIN teams t ON t.id=rr.team_id
      WHERE rr.race_id=?
        AND (? IS NULL OR rr.provider=?)
      ORDER BY d.family_name,d.given_name
    `).all(requestedRaceId,preferredProvider,preferredProvider);
  }else{
    // For F1DB-backed seasons, derive the season driver list from F1DB race
    // results. This keeps one stable F1DB identity per driver and avoids
    // duplicate Jolpica/bootstrap identities in the season-level selector.
    // Race-specific selection below still uses the exact result row/team.
    drivers=db.prepare(`
      SELECT DISTINCT
        d.id,d.given_name,d.family_name,d.code,d.permanent_number,
        d.provider,d.provider_id,
        ? AS season_year,
        NULL AS team_id,
        NULL AS team_name,
        'f1db' AS result_provider
      FROM drivers d
      WHERE EXISTS(
        SELECT 1
        FROM race_results rr
        JOIN races r ON r.id=rr.race_id
        WHERE rr.driver_id=d.id
          AND r.season_year=?
          AND rr.provider='f1db'
      )
      ORDER BY d.family_name,d.given_name
    `).all(season,season);
  }

  const sources=db.prepare(`
    SELECT code,name,base_url,requires_key,notes
    FROM data_sources
    ORDER BY id
  `).all();

  const lastSync=db.prepare(`
    SELECT provider,operation,status,rows_written,message,finished_at
    FROM sync_logs
    ORDER BY id DESC
    LIMIT 8
  `).all();

  res.json({season,seasons,drivers,races,sources,lastSync,cache:'SQLite'});
}catch(e){
  console.error(e);
  res.status(500).json({error:'Unable to load strategy catalog'});
}});

app.get('/api/strategy/historical/:raceId',(req,res)=>{try{
  const raceId=int(req.params.raceId,1,1e9);
  if(!raceId)return res.status(400).json({error:'Invalid race ID'});

  const race=db.prepare(`SELECT * FROM races WHERE id=?`).get(raceId);
  if(!race)return res.status(404).json({error:'Race not found'});

  // Historical display follows the same provider precedence as the
  // race-specific selector so duplicate provider rows are never mixed.
  const hasF1dbResults=Boolean(
    db.prepare(`
      SELECT 1
      FROM race_results
      WHERE race_id=? AND provider='f1db'
      LIMIT 1
    `).get(raceId)
  );

  const preferredProvider=hasF1dbResults?'f1db':null;

  const results=db.prepare(`
    SELECT
      rr.grid,rr.finish_position,rr.laps,rr.status,rr.fastest_lap_seconds,
      rr.provider AS result_provider,
      d.id driver_id,d.given_name,d.family_name,
      t.name team_name
    FROM race_results rr
    JOIN drivers d ON d.id=rr.driver_id
    LEFT JOIN teams t ON t.id=rr.team_id
    WHERE rr.race_id=?
      AND (? IS NULL OR rr.provider=?)
    ORDER BY
      CASE WHEN rr.finish_position IS NULL THEN 1 ELSE 0 END,
      rr.finish_position,
      d.family_name
  `).all(raceId,preferredProvider,preferredProvider);

  const providers=[...new Set(results.map(r=>r.result_provider).filter(Boolean))];
  const providerNames={
    f1db:'F1DB',
    jolpica:'Jolpica F1',
    openf1:'OpenF1',
    bootstrap:'local bootstrap'
  };
  const sourceNames=providers.map(p=>providerNames[p]||p);

  res.json({
    race,
    results,
    providers,
    source:`Stored historical context from ${sourceNames.length?sourceNames.join(' + '):race.provider}. Historical values are context only and do not automatically change simulation assumptions.`
  });
}catch(e){
  console.error(e);
  res.status(500).json({error:'Unable to load historical data'});
}});

app.post('/api/data/sync', async (req, res) => {

    const year = int(
        req.body.year || 2024,
        2023,
        2100
    );

    if (!year) {

        return res.status(400).json({
            error: 'Year must be 2023-2100'
        });
    }

    try {

        await syncSeason(year);

        res.json({
            message: `Formula 1 data sync completed for ${year}.`
        });

    } catch (e) {

        console.error(e);

        res.status(502).json({
            error:
                'External data sync failed. Existing SQLite cache remains available.',
            detail: e.message
        });
    }
});
app.get('/api/data/sync-logs',(req,res)=>res.json(db.prepare(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 30`).all()));

function validateStrategy(body){
  const name=String(body.name||'').trim(); const driverId=int(body.driverId,1,1e9); const raceId=body.raceId?int(body.raceId,1,1e9):null; const totalLaps=int(body.totalLaps,10,100);
  const fuel=num(body.fuelEffectMs,0,100),traffic=num(body.trafficLossMs,0,2000),pit=num(body.pitLossSeconds,5,60); const stints=Array.isArray(body.stints)?body.stints:[];
  if(!name||!driverId||!totalLaps||fuel===null||traffic===null||pit===null)return {error:'Invalid strategy fields'};
  if(!db.prepare(`SELECT id FROM drivers WHERE id=?`).get(driverId))return {error:'Driver not found'}; if(raceId&&!db.prepare(`SELECT id FROM races WHERE id=?`).get(raceId))return {error:'Race not found'};
  if(stints.length<1||stints.length>5)return {error:'Use between 1 and 5 stints'};
  let expected=1; const clean=[];
  for(let i=0;i<stints.length;i++){const s=stints[i];const start=int(s.startLap,1,totalLaps),end=int(s.endLap,1,totalLaps),deg=num(s.degradationMsPerLap,0,500);const compound=String(s.compound||'').toUpperCase();if(!compounds.includes(compound)||!start||!end||end<start||deg===null||start!==expected)return {error:'Stints must use valid compounds and cover consecutive laps without gaps'};clean.push({stintOrder:i+1,compound,startLap:start,endLap:end,degradationMsPerLap:deg});expected=end+1;}
  if(expected!==totalLaps+1)return {error:`Stints must finish on lap ${totalLaps}`};
  return {value:{name,driverId,raceId,totalLaps,fuelEffectMs:fuel,trafficLossMs:traffic,pitLossSeconds:pit,stints:clean}};
}
function strategyDetail(id){const s=db.prepare(`SELECT s.*,d.given_name||' '||d.family_name driver_name,d.given_name driver_given_name,d.family_name driver_family_name,d.code driver_code,d.provider driver_provider,d.provider_id driver_provider_id,r.name race_name,r.season_year race_year FROM saved_strategies s JOIN drivers d ON d.id=s.driver_id LEFT JOIN races r ON r.id=s.race_id WHERE s.id=?`).get(id);if(!s)return null;s.stints=db.prepare(`SELECT id,stint_order,compound,start_lap,end_lap,degradation_ms_per_lap FROM strategy_stints WHERE strategy_id=? ORDER BY stint_order`).all(id);return s;}
app.get('/api/strategies',(req,res)=>{const rows=db.prepare(`SELECT s.id,s.name,s.total_laps,s.created_at,s.updated_at,d.given_name||' '||d.family_name driver_name,r.name race_name,(SELECT COUNT(*)-1 FROM strategy_stints st WHERE st.strategy_id=s.id) pit_stops FROM saved_strategies s JOIN drivers d ON d.id=s.driver_id LEFT JOIN races r ON r.id=s.race_id ORDER BY s.updated_at DESC,s.id DESC`).all();res.json(rows);});
app.get('/api/strategies/:id',(req,res)=>{const id=int(req.params.id,1,1e9),s=id?strategyDetail(id):null;if(!s)return res.status(404).json({error:'Strategy not found'});res.json(s);});
app.post('/api/strategies',(req,res)=>{const v=validateStrategy(req.body);if(v.error)return res.status(400).json({error:v.error});const s=v.value;try{db.exec('BEGIN');const r=db.prepare(`INSERT INTO saved_strategies(name,driver_id,race_id,total_laps,fuel_effect_ms,traffic_loss_ms,pit_loss_seconds) VALUES(?,?,?,?,?,?,?)`).run(s.name,s.driverId,s.raceId,s.totalLaps,s.fuelEffectMs,s.trafficLossMs,s.pitLossSeconds);const id=Number(r.lastInsertRowid),ins=db.prepare(`INSERT INTO strategy_stints(strategy_id,stint_order,compound,start_lap,end_lap,degradation_ms_per_lap) VALUES(?,?,?,?,?,?)`);s.stints.forEach(x=>ins.run(id,x.stintOrder,x.compound,x.startLap,x.endLap,x.degradationMsPerLap));db.exec('COMMIT');res.status(201).json(strategyDetail(id));}catch(e){try{db.exec('ROLLBACK')}catch{}res.status(500).json({error:'Unable to save strategy'});}});
app.put('/api/strategies/:id',(req,res)=>{const id=int(req.params.id,1,1e9);if(!id||!strategyDetail(id))return res.status(404).json({error:'Strategy not found'});const v=validateStrategy(req.body);if(v.error)return res.status(400).json({error:v.error});const s=v.value;try{db.exec('BEGIN');db.prepare(`UPDATE saved_strategies SET name=?,driver_id=?,race_id=?,total_laps=?,fuel_effect_ms=?,traffic_loss_ms=?,pit_loss_seconds=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(s.name,s.driverId,s.raceId,s.totalLaps,s.fuelEffectMs,s.trafficLossMs,s.pitLossSeconds,id);db.prepare(`DELETE FROM strategy_stints WHERE strategy_id=?`).run(id);const ins=db.prepare(`INSERT INTO strategy_stints(strategy_id,stint_order,compound,start_lap,end_lap,degradation_ms_per_lap) VALUES(?,?,?,?,?,?)`);s.stints.forEach(x=>ins.run(id,x.stintOrder,x.compound,x.startLap,x.endLap,x.degradationMsPerLap));db.exec('COMMIT');res.json(strategyDetail(id));}catch(e){try{db.exec('ROLLBACK')}catch{}res.status(500).json({error:'Unable to update strategy'});}});
app.delete('/api/strategies/:id',(req,res)=>{const id=int(req.params.id,1,1e9);if(!id||!strategyDetail(id))return res.status(404).json({error:'Strategy not found'});db.prepare(`DELETE FROM saved_strategies WHERE id=?`).run(id);res.json({message:'Strategy deleted'});});

app.post('/api/simulation-runs',(req,res)=>{try{const strategyId=req.body.strategyId?int(req.body.strategyId,1,1e9):null,driverId=int(req.body.driverId,1,1e9),raceId=req.body.raceId?int(req.body.raceId,1,1e9):null,seed=int(req.body.seed,1,2147483646),total=num(req.body.totalTimeSeconds,1,100000),pitStops=int(req.body.pitStops,0,10);if(!driverId||!seed||total===null||pitStops===null||!req.body.assumptions||!req.body.result)return res.status(400).json({error:'Invalid run result'});if(strategyId&&!strategyDetail(strategyId))return res.status(400).json({error:'Strategy not found'});const r=db.prepare(`INSERT INTO simulation_runs(strategy_id,driver_id,race_id,seed,assumptions_json,result_json,total_time_seconds,pit_stops,status) VALUES(?,?,?,?,?,?,?,?, 'completed')`).run(strategyId,driverId,raceId,seed,JSON.stringify(req.body.assumptions),JSON.stringify(req.body.result),total,pitStops);res.status(201).json({id:Number(r.lastInsertRowid),message:'Simulation run stored'});}catch(e){res.status(500).json({error:'Unable to store simulation run'});}});
app.get('/api/simulation-runs',(req,res)=>{const rows=db.prepare(`SELECT sr.id,sr.seed,sr.total_time_seconds,sr.pit_stops,sr.created_at,s.name strategy_name,d.given_name||' '||d.family_name driver_name,r.name race_name FROM simulation_runs sr LEFT JOIN saved_strategies s ON s.id=sr.strategy_id JOIN drivers d ON d.id=sr.driver_id LEFT JOIN races r ON r.id=sr.race_id ORDER BY sr.id DESC LIMIT 50`).all();res.json(rows);});

app.use((req,res)=>res.status(404).json({error:'Not Found'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).json({error:'Internal Server Error'});});
app.listen(PORT,()=>console.log(`Formula 1 World running at http://localhost:${PORT} (SQLite strategy lab ready)`));
