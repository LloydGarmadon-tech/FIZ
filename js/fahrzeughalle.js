const cfg=window.FIZ_CONFIG;
const $=id=>document.getElementById(id);
const ui={clock:$('hallClock'),mqtt:$('hallMqtt'),keyword:$('hallKeyword'),address:$('hallAddress'),message:$('hallMessage'),alarmTime:$('hallAlarmTime'),coming:$('hallComing'),declined:$('hallDeclined'),open:$('hallOpen'),agt:$('hallAGT'),masch:$('hallMasch'),gf:$('hallGF'),zf:$('hallZF'),wf:$('hallWF'),boot:$('hallBoot'),feedback:$('hallFeedbackList'),vehicles:$('vehicleCards'),personnel:$('personnelTable'),restart:$('restartVehicles'),map:$('hallMap'),mapStatus:$('hallMapStatus')};
let currentAlarm=null;const feedback=new Map();let timers=[];let vehicleTick=null;let hallMapSdk=null;let hallIncidentMarker=null;const hallVehicleMarkers=new Map();
// Eindeutige Instanz-ID: verhindert, dass mehrere geöffnete Wachen-Tabs ihre
// Fahrzeugsimulationen in der Leitstelle miteinander vermischen.
const hallSourceId=`halle-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const roster=[
{name:'Alex Brandt',q:['AGT','Masch','GF','ZF','WF']},{name:'Robin Petersen',q:['AGT','Masch','GF','ZF','WF','Boot']},{name:'Sascha Krüger',q:['AGT','Masch','GF','ZF']},{name:'Daniel Martens',q:['AGT','Masch','GF','ZF','Boot']},
{name:'Jan Thomsen',q:['AGT','Masch','GF']},{name:'Marcel Hansen',q:['AGT','Masch','GF','Boot']},{name:'Tobias Neumann',q:['AGT','GF']},{name:'Patrick Schulz',q:['AGT','GF','Boot']},{name:'Nico Lange',q:['AGT','GF']},{name:'Florian Becker',q:['AGT','GF','Boot']},
{name:'Christian Wolf',q:['AGT','Masch','Boot']},{name:'Sebastian Koch',q:['AGT','Masch']},{name:'Dennis Meyer',q:['AGT','Masch','Boot']},{name:'Kevin Richter',q:['AGT','Masch']},{name:'Marco Hoffmann',q:['AGT','Masch']},{name:'Tim Wagner',q:['AGT','Masch','Boot']},
{name:'Lukas Schröder',q:['AGT']},{name:'Fabian Möller',q:['AGT']},{name:'Stefan König',q:['Masch']},{name:'Björn Lehmann',q:['Masch','Boot']},{name:'Andreas Krause',q:['Masch']},{name:'Michael Franke',q:['Masch']},
{name:'Jonas Hartmann',q:['Boot']},{name:'Niklas Werner',q:['Boot']},{name:'Simon Schwarz',q:[]},{name:'Moritz Braun',q:[]},{name:'Philipp Zimmermann',q:[]},{name:'Felix Kruse',q:[]},{name:'Henrik Albrecht',q:[]},{name:'Malte Jansen',q:[]},{name:'Ole Peters',q:[]},{name:'Kai Lorenz',q:[]},{name:'Jens Sommer',q:[]},{name:'Tom Berger',q:[]},{name:'Lennart Voß',q:[]},{name:'Arne Seidel',q:[]}
];
const vehicles=[
{id:'kdow1',name:'KdoW 1',callsign:'Florian Lauenburg 10-10-1',agency:'FW',status:2,depart:4,travel:18,active:true},
{id:'hlf20',name:'HLF 20',callsign:'Florian Lauenburg 10-48-1',agency:'FW',status:2,depart:8,travel:22,active:true},
{id:'dlk',name:'DLK 23/12',callsign:'Florian Lauenburg 10-33-1',agency:'FW',status:2,depart:10,travel:25,active:true},
{id:'elw1',name:'ELW 1',callsign:'Florian Lauenburg 10-11-1',agency:'FW',status:2,depart:13,travel:26,active:true},
{id:'rtw',name:'RTW',callsign:'Rettungsdienst 81-83-1',agency:'RD',status:2,depart:6,travel:20,active:true},
{id:'pol',name:'POL',callsign:'Polizei 22-10-1',agency:'POL',status:2,depart:7,travel:17,active:true}
];
const origins={
    FW:{address:'Reeperbahn 33, 21481 Lauenburg/Elbe',fallback:{lat:53.3710,lon:10.5580}},
    RD:{address:'Lütauer Chaussee 18, 21481 Lauenburg/Elbe',fallback:{lat:53.3788,lon:10.5700}},
    POL:{address:'Alte Wache 14, 21481 Lauenburg/Elbe',fallback:{lat:53.3678,lon:10.5570}}
};
const originCoordinates={};
// DEMO-Modus: Zeitabläufe sind bewusst auf ein Drittel komprimiert.
const DEMO_TIME_FACTOR = 1 / 3;
// V43: Nur die Fahrzeit wurde gegenueber V42 verdreifacht.
// Ausrueckzeiten und alle anderen Simulationswerte bleiben unveraendert.
const DRIVE_TIME_FACTOR = 3 / 2;

const TURNOUT_CONFIG = {
    // Basiswerte dienen nur der relativen Staffelung. Durch DEMO_TIME_FACTOR
    // werden sie für Vorführungen stark verkürzt.
    kdow: { min: 32, max: 55 },
    hlf20: { min: 58, max: 98 },
    dlk: { min: 66, max: 112 },
    elw1: { min: 74, max: 126 },
    rtw: { min: 7, max: 15 },
    pol: { min: 8, max: 18 }
};

function randomBetween(min,max){
    return min + Math.random() * (max-min);
}
function triangularBetween(min,max){
    // Mittelwerte treten häufiger auf als Extremwerte, trotzdem bleibt jeder Alarm anders.
    return (randomBetween(min,max)+randomBetween(min,max))/2;
}
function createDeparturePlan(){
    const kdow = Math.max(1, Math.round(triangularBetween(TURNOUT_CONFIG.kdow.min, TURNOUT_CONFIG.kdow.max) * DEMO_TIME_FACTOR));
    const plan = { kdow };

    ['hlf20','dlk','elw1'].forEach(id=>{
        const cfgTurnout = TURNOUT_CONFIG[id];
        let seconds = Math.max(1, Math.round(triangularBetween(cfgTurnout.min,cfgTurnout.max) * DEMO_TIME_FACTOR));

        // Der KdoW fährt als Führungsfahrzeug immer vor allen anderen Feuerwehrfahrzeugen.
        // Der Abstand variiert, damit der Ablauf nicht schematisch wirkt.
        const minimumAfterKdoW = kdow + Math.max(2, Math.round(randomBetween(8,22) * DEMO_TIME_FACTOR));
        seconds = Math.max(seconds, minimumAfterKdoW);
        plan[id] = seconds;
    });

    // Kleine zusätzliche Zufallsstaffelung verhindert identische Abfahrtszeitpunkte.
    const fwIds = ['hlf20','dlk','elw1'].sort((a,b)=>plan[a]-plan[b]);
    for(let i=1;i<fwIds.length;i++){
        const previous = fwIds[i-1];
        const current = fwIds[i];
        if(plan[current]-plan[previous] < 4){
            plan[current] = plan[previous] + Math.max(1, Math.round(randomBetween(4,11) * DEMO_TIME_FACTOR));
        }
    }

    plan.rtw = Math.max(1, Math.round(triangularBetween(TURNOUT_CONFIG.rtw.min, TURNOUT_CONFIG.rtw.max) * DEMO_TIME_FACTOR));
    plan.pol = Math.max(1, Math.round(triangularBetween(TURNOUT_CONFIG.pol.min, TURNOUT_CONFIG.pol.max) * DEMO_TIME_FACTOR));
    return plan;
}
function remainingDepartureSeconds(v){
    if(v.status!==2 || !v.plannedDepartureAt) return null;
    return Math.max(0,Math.ceil((v.plannedDepartureAt-Date.now())/1000));
}
function clock(){ui.clock.textContent=new Date().toLocaleTimeString('de-DE');}clock();setInterval(clock,1000);
function statusText(s){return s===2?'Einsatzbereit auf Wache':s===3?'Ausgerückt':s===4?'Am Einsatzort':'Unbekannt';}
function renderVehicles(){
    ui.vehicles.replaceChildren();
    // Der Hallenmonitor zeigt nur die Fahrzeuge der eigenen Feuerwehr.
    // RTW und POL werden weiterhin simuliert und per MQTT an die Leitstelle gesendet.
    vehicles.filter(v=>v.agency==='FW').forEach(v=>{
        const c=document.createElement('div');
        c.className='vehicle-card';
        const remaining=remainingDepartureSeconds(v);
        const detail=v.status===2 && remaining!==null
            ? `Besetzung läuft · ca. ${remaining}s`
            : statusText(v.status);
        c.innerHTML=`<div class="vehicle-name">${v.name}</div>
            <div class="callsign">${v.callsign}</div>
            <div class="vehicle-status">
                <span class="status-number s${v.status}">${v.status}</span>
                <span>${detail}</span>
            </div>
            <div class="progress"><i style="width:${Math.round((v.progress||0)*100)}%"></i></div>`;
        ui.vehicles.appendChild(c);
    });
}
function outcome(){const r=Math.random();return r<.72?'coming':r<.90?'declined':'received';}
function clearTimers(){timers.forEach(id=>{clearTimeout(id);clearInterval(id)});timers=[];if(vehicleTick)clearInterval(vehicleTick);vehicleTick=null;}
function renderFeedback(){let a=0,b=0,o=0;const q={AGT:0,Masch:0,GF:0,ZF:0,WF:0,Boot:0};const vals=[...feedback.values()];vals.forEach(x=>{if(x.deviceType==='apager'){if(x.response==='coming'&&x.confirmed){a++;(x.qualifications||[]).forEach(k=>q[k]=(q[k]||0)+1)}else if(x.response==='declined'&&x.confirmed)b++;else o++;}});
ui.coming.textContent=a;ui.declined.textContent=b;ui.open.textContent=o;ui.agt.textContent=q.AGT;ui.masch.textContent=q.Masch;ui.gf.textContent=q.GF;ui.zf.textContent=q.ZF;ui.wf.textContent=q.WF;ui.boot.textContent=q.Boot;
if(ui.feedback){ui.feedback.replaceChildren();if(!vals.length){ui.feedback.innerHTML='<div class="empty">Noch keine Rückmeldungen.</div>'}else vals.sort((x,y)=>(y.timestamp||'').localeCompare(x.timestamp||'')).slice(0,18).forEach(x=>{const r=document.createElement('div');r.className='feedback-row';const st=x.response==='coming'?(x.confirmed?'KOMME · bestätigt':'KOMME · offen'):x.response==='declined'?(x.confirmed?'KOMME NICHT · bestätigt':'KOMME NICHT · offen'):x.response==='acknowledged'?'DME quittiert':'Empfangen';r.innerHTML=`<span>${x.timestamp?new Date(x.timestamp).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):''}</span><strong>${x.displayName||x.deviceId}</strong><span class="state ${x.response}">${st}</span>`;ui.feedback.appendChild(r);});
}if(ui.personnel){ui.personnel.replaceChildren();roster.forEach(m=>{const id='sim-'+m.name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi,'-');const x=feedback.get(id);const s=!x?'Offen':x.response==='coming'?(x.confirmed?'Komme':'Komme · offen'):x.response==='declined'?(x.confirmed?'Komme nicht':'Komme nicht · offen'):'Offen';const row=document.createElement('div');row.className='person-row';row.innerHTML=`<strong>${m.name}</strong><span>${m.q.includes('GF')?'Führung':'Mannschaft'}</span><span class="q">${m.q.join(' · ')||'–'}</span><span class="${x?.response||'received'}">${s}</span>`;ui.personnel.appendChild(row);});}}
function addSim(m,response,confirmed){const id='sim-'+m.name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi,'-');feedback.set(id,{deviceId:id,deviceType:'apager',displayName:m.name,qualifications:m.q,response,confirmed,timestamp:new Date().toISOString()});renderFeedback();}
function simulateRoster(){roster.forEach((m,i)=>{const res=outcome();timers.push(setTimeout(()=>{addSim(m,'received',false);if(res!=='received'){timers.push(setTimeout(()=>{addSim(m,res,false);timers.push(setTimeout(()=>addSim(m,res,true),300+Math.random()*1400));},900+Math.random()*7000));}},350+Math.random()*2500+i*25));});}
async function geocode(address){
    try{
        const key=cfg.map?.mapTilerKey;
        if(!key)return null;
        let query=String(address||'').trim();
        const isLauenburg=/\bLauenburg(?:\/Elbe)?\b/i.test(query);
        if(isLauenburg){
            query=query.replace(/\bLauenburg\/Elbe\b/ig,'Lauenburg');
            if(!/\b21481\b/.test(query))query+=', 21481';
            query+=', Schleswig-Holstein, Deutschland';
        }
        const params=new URLSearchParams({key,limit:'5',country:'de',language:'de',types:'address',autocomplete:'false'});
        if(isLauenburg){
            params.set('proximity','10.566,53.371');
            params.set('bbox','10.50,53.365,10.65,53.405');
        }
        const url=`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${params}`;
        const r=await fetch(url,{headers:{Accept:'application/json'}});
        if(!r.ok)return null;
        const d=await r.json();
        const f=(d?.features||[]).find(x=>Array.isArray(x?.center)&&x.center.length>=2);
        if(f)return{lat:Number(f.center[1]),lon:Number(f.center[0]),label:f.place_name||f.text||address};
    }catch(_){}
    return null;
}
async function getOrigin(agency){
    if(originCoordinates[agency]) return originCoordinates[agency];
    const cfgOrigin=origins[agency]||origins.FW;
    originCoordinates[agency]=await geocode(cfgOrigin.address)||cfgOrigin.fallback;
    return originCoordinates[agency];
}
function haversineMeters(a,b){
    const R=6371000,rad=Math.PI/180;
    const dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
    const la1=a.lat*rad,la2=b.lat*rad;
    const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
}
function prepareRoute(points){
    const clean=(points||[]).filter(p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lon));
    if(clean.length<2)return null;
    let total=0;const cumulative=[0];
    for(let i=1;i<clean.length;i++){total+=haversineMeters(clean[i-1],clean[i]);cumulative.push(total);}
    return {points:clean,cumulative,totalMeters:total};
}
async function requestRoadRoute(start,target){
    const key=cfg.routing?.openRouteServiceKey;
    const endpoint=cfg.routing?.endpoint||'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
    if(!key||key==='HIER_ORS_API_KEY_EINTRAGEN')throw new Error('OpenRouteService API-Key fehlt');
    const r=await fetch(endpoint,{
        method:'POST',
        headers:{'Authorization':key,'Content-Type':'application/json','Accept':'application/geo+json'},
        body:JSON.stringify({
            coordinates:[[start.lon,start.lat],[target.lon,target.lat]],
            preference:cfg.routing?.preference||'fastest',
            instructions:false
        })
    });
    if(!r.ok){const txt=await r.text().catch(()=> '');throw new Error(`ORS ${r.status}${txt?': '+txt.slice(0,120):''}`);}
    const data=await r.json();
    const coords=data?.features?.[0]?.geometry?.coordinates;
    if(!Array.isArray(coords)||coords.length<2)throw new Error('ORS lieferte keine Route');
    const route=prepareRoute(coords.map(c=>({lon:Number(c[0]),lat:Number(c[1])})));
    if(!route)throw new Error('ORS-Route ungültig');
    route.durationSeconds=Number(data?.features?.[0]?.properties?.summary?.duration)||null;
    route.distanceMeters=Number(data?.features?.[0]?.properties?.summary?.distance)||route.totalMeters;
    return route;
}
function fallbackStraightRoute(start,target){return prepareRoute([start,target]);}
function pointAlongRoute(route,progress){
    if(!route?.points?.length)return null;
    const p=Math.max(0,Math.min(1,progress));
    if(p<=0)return route.points[0];if(p>=1)return route.points[route.points.length-1];
    const wanted=p*route.totalMeters;
    let i=1;while(i<route.cumulative.length&&route.cumulative[i]<wanted)i++;
    const a=route.points[i-1],b=route.points[i];
    const seg=route.cumulative[i]-route.cumulative[i-1]||1;
    const local=(wanted-route.cumulative[i-1])/seg;
    return {lat:a.lat+(b.lat-a.lat)*local,lon:a.lon+(b.lon-a.lon)*local};
}

function alarmTarget(a){
    const c=a?.location?.coordinates;
    if(Number.isFinite(Number(c?.lat))&&Number.isFinite(Number(c?.lon))){
        return {lat:Number(c.lat),lon:Number(c.lon)};
    }
    return null;
}

async function showHallMap(a){
    if(!ui.map||!window.maptilersdk)return;
    const addr=[a.location?.street,a.location?.houseNumber,a.location?.city].filter(Boolean).join(' ');
    ui.mapStatus.textContent=addr||'Einsatzort';
    const target=alarmTarget(a)||await geocode(addr);if(!target){ui.mapStatus.textContent='Einsatzadresse nicht gefunden';return;}
    if(currentAlarm?.alarmId!==a.alarmId)return;
    if(hallMapSdk){hallMapSdk.remove();hallMapSdk=null;}
    hallVehicleMarkers.clear();
    ui.map.replaceChildren();
    const mapCfg=cfg.map||{};
    if(!mapCfg.mapTilerKey){ui.map.innerHTML='<div class="hall-map-error">MapTiler API-Key fehlt.</div>';return;}
    maptilersdk.config.apiKey=mapCfg.mapTilerKey;
    hallMapSdk=new maptilersdk.Map({
        container:ui.map,
        style:maptilersdk.MapStyle.STREETS,
        center:[target.lon,target.lat],
        zoom:mapCfg.defaultZoom||14,
        navigationControl:true,
        geolocateControl:false,
        terrainControl:false
    });
    hallMapSdk.on('load',()=>{
        const el=document.createElement('div');
        el.className='hall-incident-marker';
        el.title='Einsatzort';
        hallIncidentMarker=new maptilersdk.Marker({element:el,anchor:'center'}).setLngLat([target.lon,target.lat]).addTo(hallMapSdk);
        renderHallMapVehicles();
    });
}
function renderHallMapVehicles(){
    if(!hallMapSdk||!window.maptilersdk)return;
    const active=new Set();
    vehicles.filter(v=>v.agency==='FW'&&Number.isFinite(v.lat)&&Number.isFinite(v.lon)).forEach(v=>{
        active.add(v.id);
        let m=hallVehicleMarkers.get(v.id);
        if(!m){
            const el=document.createElement('div');
            el.className=`hall-vehicle-marker s${v.status}`;
            el.innerHTML=`<i aria-hidden="true"></i><span>${v.name}</span>`;
            m=new maptilersdk.Marker({element:el,anchor:'center'}).setLngLat([v.lon,v.lat]).addTo(hallMapSdk);
            hallVehicleMarkers.set(v.id,m);
        }else{
            m.setLngLat([v.lon,v.lat]);
            const el=m.getElement();
            el.className=`hall-vehicle-marker s${v.status}`;
            el.innerHTML=`<i aria-hidden="true"></i><span>${v.name}</span>`;
        }
    });
    [...hallVehicleMarkers.entries()].forEach(([id,m])=>{if(!active.has(id)){m.remove();hallVehicleMarkers.delete(id);}});
}

function publishVehicle(v){
    if(!currentAlarm)return;
    try{
        mqtt.publish(`${cfg.topics.vehicleStatusPrefix}/${v.id}/status`,{
            type:'vehicleStatus',alarmId:currentAlarm.alarmId,sourceId:hallSourceId,vehicleId:v.id,
            name:v.name,callsign:v.callsign,agency:v.agency,status:v.status,
            statusText:statusText(v.status),lat:v.lat,lon:v.lon,
            startLat:v.startLat,startLon:v.startLon,targetLat:v.targetLat,targetLon:v.targetLon,
            progress:v.progress||0,plannedDepartureSeconds:v.depart,plannedDepartureAt:v.plannedDepartureAt||null,timestamp:new Date().toISOString()
        });
    }catch(_){}
}
async function simulateVehicles(){
    renderVehicles();
    if(!currentAlarm)return;

    const addr=[currentAlarm.location?.street,currentAlarm.location?.houseNumber,currentAlarm.location?.city].filter(Boolean).join(' ');
    const target=alarmTarget(currentAlarm)||await geocode(addr);if(!target)return;

    const agencyOrigins=await Promise.all(['FW','RD','POL'].map(async agency=>[agency,await getOrigin(agency)]));
    const originMap=Object.fromEntries(agencyOrigins);
    const departurePlan=createDeparturePlan();

    // Pro Organisation nur eine Straßenroute abrufen. Die vier Feuerwehrfahrzeuge
    // haben denselben Startpunkt und können dieselbe Route verwenden.
    const routeEntries=await Promise.all(['FW','RD','POL'].map(async agency=>{
        const start=originMap[agency]||originMap.FW;
        try{
            const route=await requestRoadRoute(start,target);
            console.info(`[Routing] ${agency}: ${Math.round(route.distanceMeters)} m über OpenRouteService`);
            return [agency,route];
        }catch(e){
            console.error(`[Routing] ${agency}: ${e.message}. Keine Luftlinien-Ersatzroute – Fahrzeug bleibt stehen.`);
            return [agency,null];
        }
    }));
    const routeMap=Object.fromEntries(routeEntries);

    vehicles.forEach((v,index)=>{
        const start=originMap[v.agency]||originMap.FW;
        const plannedDeparture=departurePlan[v.id] ?? v.depart;
        const travelVariation=randomBetween(.88,1.14);
        const plannedTravel=Math.max(4,Math.round(v.travel*travelVariation*DRIVE_TIME_FACTOR));

        Object.assign(v,{
            status:2,
            progress:0,
            depart:plannedDeparture,
            travelCurrent:plannedTravel,
            plannedDepartureAt:Date.now()+plannedDeparture*1000,
            startLat:start.lat,startLon:start.lon,
            lat:start.lat,lon:start.lon,
            targetLat:target.lat,targetLon:target.lon
        });

        v.route=routeMap[v.agency]||null;
        publishVehicle(v);

        timers.push(setTimeout(()=>{
            v.status=3;
            v.departedAt=Date.now();
            v.plannedDepartureAt=null;
            publishVehicle(v);
            renderVehicles();renderHallMapVehicles();
        },plannedDeparture*1000));

        timers.push(setTimeout(()=>{
            v.status=4;
            v.progress=1;
            v.lat=target.lat;
            v.lon=target.lon;
            publishVehicle(v);
            renderVehicles();renderHallMapVehicles();
        },(plannedDeparture+plannedTravel)*1000));
    });

    // Countdown in der Halle flüssiger aktualisieren.
    const countdownTick=setInterval(()=>{
        if(!currentAlarm) return;
        renderVehicles();renderHallMapVehicles();
    },1000);
    timers.push(countdownTick);

    vehicleTick=setInterval(()=>{
        vehicles.forEach(v=>{
            if(v.status!==3)return;
            const travelSeconds=v.travelCurrent||v.travel;
            const p=Math.min(1,(Date.now()-v.departedAt)/(travelSeconds*1000));
            v.progress=p;
            const pos=pointAlongRoute(v.route,p);
            v.lat=pos.lat;
            v.lon=pos.lon;
            publishVehicle(v);
        });
        renderVehicles();
    },1000);
}
function onAlarm(a){clearTimers();currentAlarm=a;feedback.clear();ui.keyword.textContent=a.keyword||'Alarm';ui.address.textContent=[a.location?.street,a.location?.houseNumber,a.location?.city].filter(Boolean).join(' ')||'–';ui.message.textContent=a.message||'Keine Zusatzinformationen';ui.alarmTime.textContent=new Date(a.timestamp||Date.now()).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});renderFeedback();void showHallMap(a);simulateRoster();simulateVehicles();}
function onResponse(p){if(!currentAlarm||p.alarmId!==currentAlarm.alarmId)return;const ex=feedback.get(p.deviceId)||{deviceId:p.deviceId,deviceType:p.deviceType,response:'received',confirmed:false};if(p.response==='confirmed'){ex.confirmed=true}else{ex.response=p.response;if(p.response==='coming'||p.response==='declined')ex.confirmed=false}ex.timestamp=p.timestamp||new Date().toISOString();feedback.set(p.deviceId,ex);renderFeedback();}
const hallId='wache-lauenburg';
const hallStatusTopic=`${cfg.topics.deviceStatusPrefix}/wache/${hallId}/status`;
function publishHallStatus(status){try{mqtt.publish(hallStatusTopic,{type:'status',deviceType:'wache',deviceId:hallId,displayName:'Fahrzeughalle / Wache',status,timestamp:new Date().toISOString()},true)}catch(_){}}
const mqtt=new FizMqttClient({...cfg.mqtt,clientId:`fahrzeughalle-${Date.now()}`,willTopic:hallStatusTopic,willPayload:{type:'status',deviceType:'wache',deviceId:hallId,displayName:'Fahrzeughalle / Wache',status:'offline',timestamp:new Date().toISOString()},willRetained:true,onStateChange:c=>{ui.mqtt.classList.toggle('offline',!c);ui.mqtt.textContent=c?'● MQTT verbunden':'● MQTT getrennt';},onConnect:()=>{mqtt.subscribe(cfg.topics.alarmNew);mqtt.subscribe('feuerwehr/devices/+/+/response');publishHallStatus('online');},onMessage:(t,p)=>{if(t===cfg.topics.alarmNew&&p?.type==='alarm')onAlarm(p);else if(p?.type==='response')onResponse(p);}});
ui.restart.addEventListener('click',()=>{if(currentAlarm){clearTimers();feedback.clear();renderFeedback();simulateRoster();simulateVehicles();}});
renderVehicles();renderFeedback();mqtt.connect();