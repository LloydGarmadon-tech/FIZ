const cfg=window.FIZ_CONFIG;
const mission=document.querySelector('.mission');
const street=document.querySelector('.street');
const number=document.querySelector('.number');
const city=document.querySelector('.city');
const caller=document.querySelector('.name');
const freetext=document.querySelector('.freetext');
const affectedCount=document.querySelector('.affected-count');
const callbackNotes=document.querySelector('.callback-notes');
const wFlow=document.getElementById('wFlow');
const readinessDot=document.getElementById('readinessDot');
const readinessText=document.getElementById('readinessText');
const readinessDetail=document.getElementById('readinessDetail');
const btnAlert=document.querySelector('.btnAlert');
const btnTestAlert=document.querySelector('.btnTestAlert');
const btnClear=document.querySelector('.btnClear');
const btnLocate=document.querySelector('.btnLocate');
const buttonNotruf=document.getElementById('notruf');
const messages=document.getElementById('messages');
const mqttState=document.getElementById('mqttState');
const alarmBadge=document.getElementById('alarmBadge');
const mapStatus=document.getElementById('mapStatus');
const mapElement=document.getElementById('map');
const vehicleList=document.getElementById('vehicleList');
const vehicleAlarmId=document.getElementById('vehicleAlarmId');
const countStatus2=document.getElementById('countStatus2');
const countStatus3=document.getElementById('countStatus3');
const countStatus4=document.getElementById('countStatus4');
const clearLog=document.getElementById('clearLog');
const adminDialog=document.getElementById('adminDialog');
const adminOpen=document.getElementById('adminOpen');
const adminClose=document.getElementById('adminClose');
const adminMqttState=document.getElementById('adminMqttState');
const keywordToggle=document.getElementById('keywordToggle');
const missionSuggestions=document.getElementById('missionSuggestions');
const audioManager=new AudioManager({gong:'../assets/audio/GongRW.wav'});

let currentAlarm=null;
let canonicalIncidentCoordinates=null;
let mapRequestToken=0;
let mapBounds=null;
let mapSdk=null;
let incidentMarker=null;
const vehicleMarkers=new Map();
const vehicles=new Map();

let fallbackVehicleTimers=[];
let fallbackVehicleTick=null;
let fallbackStartTimer=null;
let externalVehicleDataSeen=false;
let activeVehicleSourceId=null;
const lastVehicleMessageAt=new Map();

const fallbackVehicleDefs=[
    {vehicleId:'kdow1',name:'KdoW 1',callsign:'Florian Lauenburg 10-10-1',agency:'FW',depart:12,travel:33},
    {vehicleId:'hlf20',name:'HLF 20',callsign:'Florian Lauenburg 10-48-1',agency:'FW',depart:21,travel:36},
    {vehicleId:'dlk',name:'DLK 23/12',callsign:'Florian Lauenburg 10-33-1',agency:'FW',depart:25,travel:42},
    {vehicleId:'elw1',name:'ELW 1',callsign:'Florian Lauenburg 10-11-1',agency:'FW',depart:29,travel:42},
    {vehicleId:'rtw',name:'RTW',callsign:'Rettungsdienst 81-83-1',agency:'RD',depart:3,travel:33},
    {vehicleId:'pol',name:'POL',callsign:'Polizei 22-10-1',agency:'POL',depart:4,travel:27}
];
const fallbackOriginConfig={
    // Feuerwehr startet immer an der realen Feuerwache.
    FW:{address:'Reeperbahn 33, 21481 Lauenburg/Elbe',fallback:{lat:53.3710,lon:10.5580}},
    // RD und POL kommen für die Demo bewusst aus anderen Richtungen.
    RD:{address:'Lütauer Chaussee 18, 21481 Lauenburg/Elbe',fallback:{lat:53.3788,lon:10.5700}},
    POL:{address:'Alte Wache 14, 21481 Lauenburg/Elbe',fallback:{lat:53.3678,lon:10.5570}}
};
const fallbackOriginCoordinates={};
function mapTilerGeocodeUrl(address){
    const key=cfg.map?.mapTilerKey;
    if(!key)return null;
    let query=String(address||'').trim();
    const isLauenburg=/\bLauenburg(?:\/Elbe)?\b/i.test(query);
    // Lauenburg and Hohnstorf have similarly named streets. For Lauenburg we
    // deliberately add postcode/state and constrain the result to the city area.
    if(isLauenburg){
        query=query.replace(/\bLauenburg\/Elbe\b/ig,'Lauenburg');
        if(!/\b21481\b/.test(query))query+=', 21481';
        query+=', Schleswig-Holstein, Deutschland';
    }
    const params=new URLSearchParams({
        key,
        limit:'5',
        country:'de',
        language:'de',
        types:'address',
        autocomplete:'false'
    });
    if(isLauenburg){
        params.set('proximity','10.566,53.371');
        params.set('bbox','10.50,53.365,10.65,53.405');
    }
    return `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${params}`;
}
async function geocodeAddressMapTiler(address){
    try{
        const url=mapTilerGeocodeUrl(address);
        if(!url)return null;
        const r=await fetch(url,{headers:{Accept:'application/json'}});
        if(!r.ok)return null;
        const d=await r.json();
        const features=d?.features||[];
        const f=features.find(x=>Array.isArray(x?.center)&&x.center.length>=2);
        if(f)return{lat:Number(f.center[1]),lon:Number(f.center[0]),label:f.place_name||f.text||address};
    }catch(_){}
    return null;
}
async function getFallbackOrigin(agency){
    if(fallbackOriginCoordinates[agency])return fallbackOriginCoordinates[agency];
    const origin=fallbackOriginConfig[agency]||fallbackOriginConfig.FW;
    fallbackOriginCoordinates[agency]=await geocodeAddressMapTiler(origin.address)||origin.fallback;
    return fallbackOriginCoordinates[agency];
}
function stopFallbackVehicleSimulation(){
    fallbackVehicleTimers.forEach(clearTimeout);
    fallbackVehicleTimers=[];
    if(fallbackStartTimer){clearTimeout(fallbackStartTimer);fallbackStartTimer=null;}
    if(fallbackVehicleTick)clearInterval(fallbackVehicleTick);
    fallbackVehicleTick=null;
}
function routeDistanceMeters(a,b){
    const R=6371000,rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLon=(b.lon-a.lon)*rad;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLon/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
}
function prepareFallbackRoute(points){
    if(!Array.isArray(points)||points.length<2)return null;
    let total=0;const cumulative=[0];
    for(let i=1;i<points.length;i++){total+=routeDistanceMeters(points[i-1],points[i]);cumulative.push(total);}
    return {points,cumulative,totalMeters:total};
}
async function requestFallbackRoadRoute(start,target){
    const key=cfg.routing?.openRouteServiceKey;
    const endpoint=cfg.routing?.endpoint||'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
    if(!key||key==='HIER_ORS_API_KEY_EINTRAGEN')throw new Error('OpenRouteService API-Key fehlt in js/shared/config.js – Straßenrouting kann nicht gestartet werden.');
    try{
        const r=await fetch(endpoint,{method:'POST',headers:{Authorization:key,'Content-Type':'application/json','Accept':'application/geo+json'},body:JSON.stringify({coordinates:[[start.lon,start.lat],[target.lon,target.lat]],preference:cfg.routing?.preference||'fastest',instructions:false})});
        if(!r.ok)throw new Error(`ORS ${r.status}`);
        const d=await r.json(),coords=d?.features?.[0]?.geometry?.coordinates;
        if(!Array.isArray(coords)||coords.length<2)throw new Error('keine Route');
        return prepareFallbackRoute(coords.map(c=>({lon:Number(c[0]),lat:Number(c[1])})));
    }catch(e){log(`Routing FEHLER: ${e.message}`);throw e;}
}
function fallbackPoint(route,p){
    if(!route?.points?.length)return null;
    p=Math.max(0,Math.min(1,p));if(p<=0)return route.points[0];if(p>=1)return route.points.at(-1);
    const wanted=p*route.totalMeters;let i=1;while(i<route.cumulative.length&&route.cumulative[i]<wanted)i++;
    const a=route.points[i-1],b=route.points[i],seg=route.cumulative[i]-route.cumulative[i-1]||1,local=(wanted-route.cumulative[i-1])/seg;
    return {lat:a.lat+(b.lat-a.lat)*local,lon:a.lon+(b.lon-a.lon)*local};
}

async function startFallbackVehicleSimulation(a){
    stopFallbackVehicleSimulation();
    externalVehicleDataSeen=false;
    const addr=responseAddress(a);
    const c=a?.location?.coordinates;
    const target=(Number.isFinite(Number(c?.lat))&&Number.isFinite(Number(c?.lon)))?{lat:Number(c.lat),lon:Number(c.lon)}:await geocodeAddressMapTiler(addr);
    if(!target){
        log(`Karte: Einsatzadresse nicht gefunden (${addr})`);
        return;
    }
    if(currentAlarm?.alarmId!==a.alarmId)return;

    const originEntries=await Promise.all(['FW','RD','POL'].map(async agency=>[agency,await getFallbackOrigin(agency)]));
    // Wenn inzwischen echte Fahrzeugdaten aus der Wache angekommen sind,
    // darf die lokale Ersatzsimulation diese niemals überschreiben.
    if(externalVehicleDataSeen||currentAlarm?.alarmId!==a.alarmId)return;
    const originMap=Object.fromEntries(originEntries);
    const routeEntries=await Promise.all(['FW','RD','POL'].map(async agency=>[agency,await requestFallbackRoadRoute(originMap[agency]||originMap.FW,target)]));
    if(externalVehicleDataSeen||currentAlarm?.alarmId!==a.alarmId)return;
    const routeMap=Object.fromEntries(routeEntries);

    fallbackVehicleDefs.forEach((d,index)=>{
        const start=originMap[d.agency]||originMap.FW;
        const v={...d,status:2,progress:0,lat:start.lat,lon:start.lon,startLat:start.lat,startLon:start.lon,targetLat:target.lat,targetLon:target.lon,alarmId:a.alarmId,route:routeMap[d.agency]};
        vehicles.set(v.vehicleId,v);
        fallbackVehicleTimers.push(setTimeout(()=>{
            if(externalVehicleDataSeen||currentAlarm?.alarmId!==a.alarmId)return;
            v.status=3;v.departedAt=Date.now();renderVehicles();renderVehicleMarkers();
        },d.depart*1000));
        fallbackVehicleTimers.push(setTimeout(()=>{
            if(externalVehicleDataSeen||currentAlarm?.alarmId!==a.alarmId)return;
            v.status=4;v.progress=1;v.lat=target.lat;v.lon=target.lon;renderVehicles();renderVehicleMarkers();
        },(d.depart+d.travel)*1000));
    });
    renderVehicles();renderVehicleMarkers();
    fallbackVehicleTick=setInterval(()=>{
        if(externalVehicleDataSeen){stopFallbackVehicleSimulation();return;}
        fallbackVehicleDefs.forEach((d,index)=>{
            const v=vehicles.get(d.vehicleId);
            if(!v||v.status!==3)return;
            const p=Math.min(1,(Date.now()-v.departedAt)/(d.travel*1000));
            v.progress=p;
            const pos=fallbackPoint(v.route,p);
            v.lat=pos.lat;v.lon=pos.lon;
        });
        renderVehicles();renderVehicleMarkers();
    },500);
}


const alarmKeywordCatalog=[
{code:'FEU 00',label:'Feuer / Kleinbrand'},{code:'FEU 01',label:'Feuer Standard'},{code:'FEU 02',label:'Feuer erweitert'},{code:'FEU 03',label:'Großbrand / erhöhter Kräfteansatz'},
{code:'FEU BMA',label:'Brandmeldeanlage'},{code:'FEU K',label:'Kleinbrand'},{code:'FEU WALD',label:'Wald- / Flächenbrand'},{code:'FEU SCHIFF',label:'Feuer Wasserfahrzeug'},
{code:'TH K',label:'Technische Hilfe klein'},{code:'TH Y',label:'Technische Hilfe · Menschenleben in Gefahr'},{code:'TH GAS',label:'Gasaustritt / Gasgeruch'},{code:'TH WASSER',label:'Wasserschaden'},
{code:'TH TIER',label:'Tierrettung'},{code:'TH VERKEHR',label:'Verkehrsunfall / technische Rettung'},{code:'TH BAUM',label:'Baum / Ast'},{code:'TH ÖL',label:'Ölspur / Betriebsstoffe'},
{code:'NOTF 01',label:'Notfall / medizinische Hilfe'},{code:'NOTF 02',label:'Notfall mit erweitertem Kräftebedarf'},{code:'WASSER Y',label:'Wasserrettung · Menschenleben in Gefahr'},{code:'BOOT',label:'Bootseinsatz / Hilfeleistung auf dem Wasser'}];
let highlightedKeywordIndex=-1;

function log(text,kind='system'){const row=document.createElement('div');row.className=`log-row log-${kind}`;const time=document.createElement('span');time.className='log-time';time.textContent=new Date().toLocaleTimeString('de-DE');const badge=document.createElement('span');badge.className='log-badge';badge.textContent=kind==='connect'?'VERBINDUNG':kind==='response'?'RÜCKMELDUNG':kind==='alarm'?'ALARM':'SYSTEM';const msg=document.createElement('span');msg.className='log-message';msg.textContent=text;row.append(time,badge,msg);messages.prepend(row);}
function participantLabel(p){const type=p?.deviceType==='apager'?'aPager':p?.deviceType==='dme'?'DME':p?.deviceType==='wache'?'Wache':(p?.deviceType||'Teilnehmer');return `${type} ${p?.displayName||p?.deviceId||''}`.trim();}
function logParticipantStatus(p){if(!p?.deviceType)return;const state=p.status==='online'?'verbunden':p.status==='offline'?'Verbindung getrennt':String(p.status||'Status unbekannt');log(`${participantLabel(p)}: ${state}`,'connect');}
function logParticipantResponse(p){if(!p?.deviceType)return;const labels={received:'Alarm empfangen',acknowledged:'Alarm quittiert',coming:'KOMME gewählt',declined:'KOMME NICHT gewählt',confirmed:'Rückmeldung bestätigt'};const text=labels[p.response]||`Rückmeldung: ${p.response||'unbekannt'}`;log(`${participantLabel(p)}: ${text}${p.alarmId?` · Einsatz ${p.alarmId}`:''}`,'response');}
function responseAddress(a){return[a.location?.street,a.location?.houseNumber,a.location?.city].filter(Boolean).join(' ');}
function buildAlarm(){return FizAlarm.createAlarm({keyword:mission.value,street:street.value,houseNumber:number.value,city:city.value,caller:caller.value,affectedCount:affectedCount.value,message:freetext.value,callbackNotes:callbackNotes.value});}
function validateLocation(a,focus=true){const missing=[];if(!a.location?.street?.trim())missing.push({e:street,n:'Straße'});if(!a.location?.houseNumber?.trim())missing.push({e:number,n:'Hausnummer'});if(!a.location?.city?.trim())missing.push({e:city,n:'Ort'});[street,number,city].forEach(e=>e.classList.remove('field-error'));missing.forEach(x=>x.e.classList.add('field-error'));if(missing.length){readinessText.textContent='Alarmierung nicht möglich';readinessDetail.textContent=`Einsatzadresse unvollständig: ${missing.map(x=>x.n).join(', ')}`;if(focus)missing[0].e.focus();return false}return true;}

async function sendAlarm(a){
    if(!validateLocation(a))return false;
    try{
        // Einsatzadresse genau einmal in der Leitstelle geocodieren. Diese
        // Koordinate ist danach die einzige Quelle für Karte, Wache und Fahrzeuge.
        const target=await geocodeAddressMapTiler(responseAddress(a));
        if(target){
            a.location.coordinates={lat:target.lat,lon:target.lon};
            canonicalIncidentCoordinates=Object.freeze({lat:Number(target.lat),lon:Number(target.lon)});
        }
        mqtt.publish(cfg.topics.alarmNew,a);
        currentAlarm=a;vehicles.clear();activeVehicleSourceId=null;lastVehicleMessageAt.clear();externalVehicleDataSeen=false;alarmBadge.textContent='Alarm aktiv';alarmBadge.className='alarm-badge active';vehicleAlarmId.textContent=`${a.keyword||'Einsatz'} · ${new Date(a.timestamp).toLocaleTimeString()}`;renderVehicles();log(`Alarm ${a.alarmId} gesendet: ${a.keyword}`,'alarm');void locateAlarm(a);
        // Die Leitstelle bleibt auch ohne geöffnete Wache funktionsfähig. Die lokale
        // Fahrzeugsimulation startet aber erst nach kurzer Wartezeit. Treffen vorher
        // echte Fahrzeugdaten aus der Wache ein, werden ausschließlich diese benutzt.
        fallbackStartTimer=setTimeout(()=>{
            fallbackStartTimer=null;
            if(!externalVehicleDataSeen&&currentAlarm?.alarmId===a.alarmId)void startFallbackVehicleSimulation(a);
        },1800);
        return true
    }catch(e){log(`Alarm konnte nicht gesendet werden: ${e.message}`);return false}
}
function clearForm(){
    [mission,street,number,city,caller,freetext,affectedCount,callbackNotes].forEach(x=>{
        x.value='';
        x.classList.remove('field-error');
    });
    closeSuggestions();
    updateWFlow();
    street.focus();
}
function clearInputMask(){
    clearForm();
    log('Eingabemaske geleert');
}

function renderMapPlaceholder(title,detail,css=''){mapElement.replaceChildren();const box=document.createElement('div');box.className=`map-placeholder ${css}`.trim();box.innerHTML=`<div class="map-placeholder-icon">⌖</div><strong>${title}</strong><span>${detail}</span>`;mapElement.appendChild(box);}
function showEmbeddedMap(lat,lon,address,keyword){
    if(!window.maptilersdk){
        mapElement.innerHTML='<div class="map-error">MapTiler SDK konnte nicht geladen werden.</div>';
        return;
    }

    if(mapSdk){
        mapSdk.remove();
        mapSdk=null;
    }
    incidentMarker=null;
    vehicleMarkers.clear();
    mapElement.replaceChildren();

    const mapCfg=cfg.map||{};
    const apiKey=mapCfg.mapTilerKey||'';
    const zoom=mapCfg.defaultZoom||14;

    if(!apiKey){
        mapElement.innerHTML='<div class="map-error">MapTiler API-Key fehlt in js/shared/config.js.</div>';
        return;
    }

    maptilersdk.config.apiKey=apiKey;

    mapSdk=new maptilersdk.Map({
        container:mapElement,
        style:maptilersdk.MapStyle.STREETS,
        center:[lon,lat],
        zoom,
        navigationControl:true,
        geolocateControl:false,
        terrainControl:false
    });

    mapSdk.on('load',()=>{
        canonicalIncidentCoordinates=Object.freeze({lat:Number(lat),lon:Number(lon)});
        ensureCoordinateLayers();
        renderVehicleMarkers();
    });

    mapSdk.on('error',(e)=>{
        console.warn('MapTiler:',e?.error||e);
    });
}
async function fetchJson(url,timeout=4000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}finally{clearTimeout(t)}}
async function geocode(a){
    const c=a?.location?.coordinates;
    if(Number.isFinite(Number(c?.lat))&&Number.isFinite(Number(c?.lon))){
        return {lat:Number(c.lat),lon:Number(c.lon),label:responseAddress(a)};
    }
    const address=responseAddress(a);
    const result=await geocodeAddressMapTiler(address);
    if(result)return result;
    throw new Error('Adresse nicht gefunden');
}
async function locateAlarm(a){const token=++mapRequestToken;if(mapSdk){mapSdk.remove();mapSdk=null;incidentMarker=null;vehicleMarkers.clear();}const address=responseAddress(a);mapStatus.textContent='Suche Einsatzort …';renderMapPlaceholder('Einsatzort wird gesucht',address,'searching');btnLocate.disabled=true;try{const r=await geocode(a);if(token!==mapRequestToken)return;showEmbeddedMap(r.lat,r.lon,address,a.keyword);mapStatus.textContent=address}catch(e){if(token!==mapRequestToken)return;mapStatus.textContent='Karte nicht verfügbar';renderMapPlaceholder('Karte nicht verfügbar',`${e.message}. Fahrzeugstatus werden trotzdem angezeigt.`,'error')}finally{if(token===mapRequestToken)btnLocate.disabled=false}}

function agencyClass(a){return a==='POL'?'pol':a==='RD'?'rd':'fw'}
function vehicleGeoJson(){
    return {
        type:'FeatureCollection',
        features:[...vehicles.values()]
            .filter(v=>Number.isFinite(Number(v.lat))&&Number.isFinite(Number(v.lon)))
            .map(v=>({
                type:'Feature',
                geometry:{type:'Point',coordinates:[Number(v.lon),Number(v.lat)]},
                properties:{
                    id:String(v.vehicleId||''),
                    name:String(v.name||''),
                    agency:String(v.agency||'FW'),
                    status:Number(v.status)||0
                }
            }))
    };
}
function ensureCoordinateLayers(){
    if(!mapSdk||!mapSdk.isStyleLoaded())return false;
    if(!mapSdk.getSource('fiz-vehicles')){
        mapSdk.addSource('fiz-vehicles',{type:'geojson',data:vehicleGeoJson()});
        mapSdk.addLayer({
            id:'fiz-vehicle-dots',type:'circle',source:'fiz-vehicles',
            paint:{
                'circle-radius':5,
                'circle-color':['match',['get','agency'],'POL','#2f80ed','RD','#f2a93b','#e7353f'],
                'circle-stroke-color':'#ffffff','circle-stroke-width':2
            }
        });
        mapSdk.addLayer({
            id:'fiz-vehicle-labels',type:'symbol',source:'fiz-vehicles',
            layout:{
                'text-field':['get','name'],'text-size':10,'text-font':['Open Sans Bold'],
                'text-offset':[0,-1.45],'text-anchor':'bottom',
                'text-allow-overlap':true,'text-ignore-placement':true
            },
            paint:{
                'text-color':'#ffffff','text-halo-color':['match',['get','agency'],'POL','#1d67bf','RD','#d97a11','#b61f28'],
                'text-halo-width':4,'text-halo-blur':0
            }
        });
    }
    if(canonicalIncidentCoordinates&&!mapSdk.getSource('fiz-incident')){
        mapSdk.addSource('fiz-incident',{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:[canonicalIncidentCoordinates.lon,canonicalIncidentCoordinates.lat]},properties:{}}});
        mapSdk.addLayer({id:'fiz-incident-dot',type:'circle',source:'fiz-incident',paint:{'circle-radius':7,'circle-color':'#e32932','circle-stroke-color':'#ffffff','circle-stroke-width':3}});
    }
    return true;
}
function renderVehicleMarkers(){
    if(!mapSdk)return;
    if(!ensureCoordinateLayers())return;
    const vs=mapSdk.getSource('fiz-vehicles');
    if(vs)vs.setData(vehicleGeoJson());
    if(canonicalIncidentCoordinates){
        const is=mapSdk.getSource('fiz-incident');
        if(is)is.setData({type:'Feature',geometry:{type:'Point',coordinates:[canonicalIncidentCoordinates.lon,canonicalIncidentCoordinates.lat]},properties:{}});
    }
}
function renderVehicles(){vehicleList.replaceChildren();if(!vehicles.size){vehicleList.innerHTML='<div class="empty-state">Warte auf Fahrzeugdaten aus der Fahrzeughalle …</div>'}else{[...vehicles.values()].sort((a,b)=>(a.agency+a.name).localeCompare(b.agency+b.name)).forEach(v=>{const row=document.createElement('div');row.className='feedback-item vehicle-feedback-item';const dot=document.createElement('span');dot.className=`vehicle-agency-dot ${agencyClass(v.agency)}`;const body=document.createElement('div');body.innerHTML=`<div class="feedback-device">${v.name}</div><div class="feedback-meta">${v.callsign||''}</div>`;const state=document.createElement('div');state.className=`vehicle-state s${v.status}`;state.innerHTML=`<strong>${v.status}</strong><span>${v.statusText||''}</span>`;row.append(dot,body,state);vehicleList.appendChild(row)})}
let s2=0,s3=0,s4=0;vehicles.forEach(v=>{if(v.status===2)s2++;else if(v.status===3)s3++;else if(v.status===4)s4++});countStatus2.textContent=s2;countStatus3.textContent=s3;countStatus4.textContent=s4;renderVehicleMarkers();}
function handleVehicle(p){
    if(!currentAlarm||p.alarmId!==currentAlarm.alarmId)return;

    // Pro Einsatz wird genau EINE Fahrzeughallen-Instanz als Datenquelle verwendet.
    // So können versehentlich parallel geöffnete Wachen-Tabs die Positionen nicht
    // gegenseitig überschreiben.
    const sourceId=String(p.sourceId||'legacy-hall');
    if(activeVehicleSourceId===null)activeVehicleSourceId=sourceId;
    if(sourceId!==activeVehicleSourceId)return;

    const messageTime=Date.parse(p.timestamp||'')||Date.now();
    const previousTime=lastVehicleMessageAt.get(p.vehicleId)||0;
    if(messageTime<previousTime)return;
    lastVehicleMessageAt.set(p.vehicleId,messageTime);

    // Externe Fahrzeugdaten werden 1:1 dargestellt. Die Fahrzeughalle ist die
    // Quelle der simulierten Fahrzeugpositionen; in der Leitstelle darf weder
    // lat/lon vertauscht noch auf targetLat/targetLon bzw. eine neu geocodierte
    // Alarmkoordinate umgerechnet werden.
    let lat=Number(p.lat), lon=Number(p.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return;

    // WICHTIG: Der Einsatzort ist unveränderlich. Er wird beim Alarm EINMAL
    // geocodiert und danach nie wieder aus Fahrzeugmeldungen abgeleitet.
    // Status 4 heißt exakt "am Einsatzort"; deshalb bekommen alle Fahrzeuge
    // in Status 4 dieselbe kanonische Einsatzkoordinate. Nur Status 2/3 nutzen
    // die von der Fahrzeughalle gemeldete aktuelle Fahrzeugposition.
    if(Number(p.status)===4 && canonicalIncidentCoordinates){
        lat=canonicalIncidentCoordinates.lat;
        lon=canonicalIncidentCoordinates.lon;
    }

    vehicles.set(p.vehicleId,{...p,lat,lon});

    // Der rote Einsatzpunkt bleibt immer auf der beim Alarm ermittelten
    // Koordinate und wird ausdrücklich NICHT durch Fahrzeugdaten verschoben.
    renderVehicles();
}

function filteredKeywords(){const term=mission.value.trim().toLowerCase();return term?alarmKeywordCatalog.filter(i=>i.code.toLowerCase().includes(term)||i.label.toLowerCase().includes(term)):alarmKeywordCatalog}
function closeSuggestions(){missionSuggestions.classList.add('is-hidden');mission.setAttribute('aria-expanded','false');highlightedKeywordIndex=-1}
function chooseKeyword(i){mission.value=i.code;closeSuggestions();mission.dispatchEvent(new Event('input',{bubbles:true}));freetext.focus()}
function renderSuggestions(force=false){const m=filteredKeywords();missionSuggestions.replaceChildren();highlightedKeywordIndex=-1;if(!m.length){const e=document.createElement('div');e.className='keyword-empty';e.textContent='Kein Stichwort gefunden';missionSuggestions.append(e)}else m.forEach((i,n)=>{const b=document.createElement('button');b.type='button';b.className='keyword-option';b.innerHTML=`<strong>${i.code}</strong><span>${i.label}</span>`;b.onmousedown=e=>e.preventDefault();b.onclick=()=>chooseKeyword(i);missionSuggestions.append(b)});if(force||document.activeElement===mission){missionSuggestions.classList.remove('is-hidden');mission.setAttribute('aria-expanded','true')}}
function highlight(delta){const opts=[...missionSuggestions.querySelectorAll('.keyword-option')];if(!opts.length)return;highlightedKeywordIndex=Math.max(0,Math.min(opts.length-1,highlightedKeywordIndex+delta));opts.forEach((o,i)=>o.classList.toggle('highlighted',i===highlightedKeywordIndex));opts[highlightedKeywordIndex].scrollIntoView({block:'nearest'})}
mission.addEventListener('focus',()=>renderSuggestions(true));mission.addEventListener('input',()=>{renderSuggestions(true);updateWFlow()});mission.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();highlight(1)}else if(e.key==='ArrowUp'){e.preventDefault();highlight(-1)}else if(e.key==='Enter'&&highlightedKeywordIndex>=0){e.preventDefault();e.stopPropagation();chooseKeyword(filteredKeywords()[highlightedKeywordIndex])}else if(e.key==='Escape')closeSuggestions()});keywordToggle.addEventListener('click',()=>{mission.focus();renderSuggestions(true)});document.addEventListener('click',e=>{if(!e.target.closest('.keyword-combobox'))closeSuggestions()});

function isFilled(e){return e&&String(e.value||'').trim().length>0}
function stepComplete(step){const n=Number(step.dataset.step);if(n===1)return isFilled(street)&&isFilled(number)&&isFilled(city);if(n===2)return isFilled(caller);if(n===3)return isFilled(mission)&&isFilled(freetext);if(n===4)return isFilled(affectedCount);if(n===5)return true;return false}
function updateWFlow(){const steps=[...document.querySelectorAll('.w-step')];steps.forEach(s=>s.classList.toggle('complete',stepComplete(s)));const ready=isFilled(street)&&isFilled(number)&&isFilled(city)&&isFilled(mission);if(ready){readinessDot.className='ready';readinessText.textContent='Alarmierung möglich';readinessDetail.textContent='Einsatzadresse und Stichwort vorhanden'}else{readinessDot.className='';readinessText.textContent='Notruf wird aufgenommen';readinessDetail.textContent='Einsatzort und Stichwort erfassen'}}
document.querySelectorAll('.flow-input').forEach(e=>e.addEventListener('input',updateWFlow));
btnAlert.addEventListener('click',async()=>{const a=buildAlarm();if(await sendAlarm(a))clearForm()});
btnClear.addEventListener('click',clearInputMask);
btnTestAlert.addEventListener('click',async()=>{mission.value='FEU 03';street.value='Bahnhofstraße';number.value='18';city.value='21481 Lauenburg';caller.value='Testanrufer';freetext.value='Rauchentwicklung aus einem Gebäude, Personenlage unklar';affectedCount.value='2';callbackNotes.value='Anrufer wartet vor Ort.';updateWFlow();await sendAlarm(buildAlarm())});
btnLocate.addEventListener('click',()=>void locateAlarm(buildAlarm()));
buttonNotruf.addEventListener('click',()=>{buttonNotruf.classList.remove('calling');btnAlert.disabled=false});
window.addEventListener('keydown',e=>{if(e.shiftKey&&e.key.toLowerCase()==='a'){buttonNotruf.classList.add('calling');audioManager.play('gong');btnAlert.disabled=false}if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();btnAlert.click()}});
adminOpen.addEventListener('click',()=>adminDialog.showModal());adminClose.addEventListener('click',()=>adminDialog.close());clearLog.addEventListener('click',()=>messages.replaceChildren());

const mqtt=new FizMqttClient({...cfg.mqtt,clientId:`leitstelle-${Date.now()}`,onStateChange:(c,d)=>{mqttState.textContent=c?'● MQTT verbunden':'● MQTT getrennt';mqttState.dataset.connected=c?'true':'false';adminMqttState.textContent=c?'MQTT: verbunden':'MQTT: getrennt';log(`Leitstelle MQTT: ${d}`)},onReconnectScheduled:d=>log(`Neuer Verbindungsversuch in ${Math.round(d/1000)} s`),onConnect:()=>{mqtt.subscribe(`${cfg.topics.vehicleStatusPrefix}/+/status`);mqtt.subscribe(`${cfg.topics.deviceStatusPrefix}/+/+/status`);mqtt.subscribe(`${cfg.topics.deviceStatusPrefix}/+/+/response`);mqtt.publish(cfg.topics.leitstelleStatus,{type:'status',status:'online',timestamp:new Date().toISOString()},true)},onMessage:(t,p)=>{if(p?.type==='vehicleStatus'){if(!externalVehicleDataSeen){externalVehicleDataSeen=true;stopFallbackVehicleSimulation();vehicles.clear();}handleVehicle(p);return;}if(p?.type==='status'){logParticipantStatus(p);return;}if(p?.type==='response'){logParticipantResponse(p);}}});
renderVehicles();updateWFlow();mqtt.connect();