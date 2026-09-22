const cfg = window.FIZ_CONFIG;
const deviceId = sessionStorage.getItem('apagerDeviceId') || `apager-${Math.floor(Math.random() * 1000).toString().padStart(3,'0')}`;
sessionStorage.setItem('apagerDeviceId', deviceId);

const ui = {
    androidTime: document.getElementById('androidTime'),
    connectionState: document.getElementById('connectionState'),
    connectionText: document.getElementById('connectionText'),
    backButton: document.getElementById('backButton'),
    screenTitle: document.getElementById('screenTitle'),
    screenSubtitle: document.getElementById('screenSubtitle'),
    dashboardScreen: document.getElementById('dashboardScreen'),
    alarmScreen: document.getElementById('alarmScreen'),
    deviceLabel: document.getElementById('deviceLabel'),
    emptyState: document.getElementById('emptyState'),
    alarmList: document.getElementById('alarmList'),
    alarmTime: document.getElementById('alarmTime'),
    alarmKeyword: document.getElementById('alarmKeyword'),
    alarmLocation: document.getElementById('alarmLocation'),
    alarmMessage: document.getElementById('alarmMessage'),
    alarmAddress: document.getElementById('alarmAddress'),
    alarmAffected: document.getElementById('alarmAffected'),
    alarmCaller: document.getElementById('alarmCaller'),
    alarmQuestions: document.getElementById('alarmQuestions'),
    alarmId: document.getElementById('alarmId'),
    extraDetails: document.getElementById('extraDetails'),
    navigationButton: document.getElementById('navigationButton'),
    detailsButton: document.getElementById('detailsButton'),
    responseHint: document.getElementById('responseHint'),
    btnComing: document.getElementById('btnComing'),
    btnDeclined: document.getElementById('btnDeclined'),
    confirmSheet: document.getElementById('confirmSheet'),
    sheetIcon: document.getElementById('sheetIcon'),
    confirmText: document.getElementById('confirmText'),
    btnConfirm: document.getElementById('btnConfirm'),
    btnCancel: document.getElementById('btnCancel'),
    toast: document.getElementById('toast'),
    navAlarms: document.getElementById('navAlarms'),
    navMap: document.getElementById('navMap'),
    mapScreen: document.getElementById('mapScreen'),
    mapAddress: document.getElementById('mapAddress'),
    mapLoading: document.getElementById('mapLoading'),
    mapLoadingText: document.getElementById('mapLoadingText'),
    mapFrame: document.getElementById('mapFrame'),
    mapError: document.getElementById('mapError'),
    mapErrorText: document.getElementById('mapErrorText'),
    incomingAlarm: document.getElementById('incomingAlarm'),
    incomingTime: document.getElementById('incomingTime'),
    incomingKeyword: document.getElementById('incomingKeyword'),
    incomingAddress: document.getElementById('incomingAddress'),
    incomingMessage: document.getElementById('incomingMessage'),
    btnOpenAlarm: document.getElementById('btnOpenAlarm')
};

const audioManager = new AudioManager({ alarm: '../assets/audio/alamos_alt.mp3' });
const history = [];
let currentAlarm = null;
let selectedResponse = null;
let toastTimer = null;
let vibrationTimer = null;
let alarmOpened = false;
let mapAbortController = null;
const geocodeCache = new Map();

ui.deviceLabel.textContent = deviceId.toUpperCase();
updateClock();
setInterval(updateClock, 15000);

const mqtt = new FizMqttClient({
    ...cfg.mqtt,
    clientId: deviceId,
    willTopic: `${cfg.topics.deviceStatusPrefix}/apager/${deviceId}/status`,
    willPayload: { type:'status', deviceType:'apager', deviceId, status:'offline', timestamp:new Date().toISOString() },
    willRetained: true,
    onStateChange: connected => setConnectionState(connected),
    onConnect: () => {
        mqtt.subscribe(cfg.topics.alarmNew);
        publishStatus('online');
        if (!currentAlarm) showDashboard();
    },
    onMessage: (topic, payload) => {
        if (topic === cfg.topics.alarmNew && payload && payload.type === 'alarm') receiveAlarm(payload);
    }
});

function updateClock() {
    ui.androidTime.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function setConnectionState(connected) {
    ui.connectionState.classList.toggle('offline', !connected);
    ui.connectionText.textContent = connected ? 'Online' : 'Offline';
}

function topic(kind) {
    return `${cfg.topics.deviceStatusPrefix}/apager/${deviceId}/${kind}`;
}

function publishStatus(status) {
    try {
        mqtt.publish(topic('status'), {
            type: 'status', deviceType: 'apager', deviceId, status,
            timestamp: new Date().toISOString()
        }, true);
    } catch (_) { }
}

function publishResponse(response) {
    if (!currentAlarm) return;
    try {
        mqtt.publish(topic('response'), {
            type: 'response', deviceType: 'apager', deviceId,
            alarmId: currentAlarm.alarmId, response,
            timestamp: new Date().toISOString()
        });
    } catch (_) { }
}

function receiveAlarm(alarm) {
    if (currentAlarm && currentAlarm.alarmId !== alarm.alarmId) {
        history.unshift({ alarm: currentAlarm, response: null, confirmedAt: null, superseded: true });
    }

    currentAlarm = alarm;
    selectedResponse = null;
    alarmOpened = false;
    publishResponse('received');
    fillAlarm(alarm);
    startAttention();
    showIncomingAlarm(alarm);
}

function startAttention() {
    audioManager.play('alarm', true);
    document.title = '🚨 NEUER ALARM – aPager PRO';
    document.body.classList.add('alarm-active');

    // Android-Browser unterstützen Vibration nur nach Berechtigung/Benutzerinteraktion.
    // Wenn verfügbar, wird ein typisches Alarmmuster verwendet; andernfalls bleibt der Ton.
    try {
        if (navigator.vibrate) {
            navigator.vibrate([700, 250, 700, 250, 1200]);
            clearInterval(vibrationTimer);
            vibrationTimer = setInterval(() => {
                if (currentAlarm && !alarmOpened) navigator.vibrate([700, 250, 700, 250, 1200]);
            }, 4200);
        }
    } catch (_) { }
}

function stopAttention() {
    audioManager.stop('alarm');
    clearInterval(vibrationTimer);
    vibrationTimer = null;
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (_) { }
    document.body.classList.remove('alarm-active');
    document.title = 'aPager PRO – Simulation';
}

function showIncomingAlarm(alarm) {
    const location = alarm.location || {};
    const address = [location.street, location.houseNumber, location.city].filter(Boolean).join(' ');
    const time = alarm.timestamp ? new Date(alarm.timestamp) : new Date();

    ui.incomingTime.textContent = time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    ui.incomingKeyword.textContent = alarm.keyword || 'Alarmierung';
    ui.incomingAddress.textContent = address || 'Einsatzort nicht angegeben';
    ui.incomingMessage.textContent = alarm.message || alarm.freeText || 'Keine weiteren Angaben';
    ui.incomingAlarm.classList.remove('is-hidden');
}

function openCurrentAlarm() {
    if (!currentAlarm) return;
    alarmOpened = true;
    ui.incomingAlarm.classList.add('is-hidden');

    // Öffnen quittiert den akustischen Hinweis, aber NICHT die Einsatz-Rückmeldung.
    // Die Leitstelle sieht weiterhin nur "received", bis KOMME/KOMME NICHT bestätigt wird.
    stopAttention();
    showAlarm();
}

function fillAlarm(alarm) {
    const location = alarm.location || {};
    const address = [location.street, location.houseNumber, location.city].filter(Boolean).join(' ');
    const time = alarm.timestamp ? new Date(alarm.timestamp) : new Date();

    ui.alarmTime.textContent = `Alarmiert ${time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    ui.alarmKeyword.textContent = alarm.keyword || 'Alarmierung';
    ui.alarmLocation.textContent = address || 'Einsatzort nicht angegeben';
    ui.alarmAddress.textContent = address || '–';
    ui.alarmMessage.textContent = alarm.message || alarm.freeText || 'Keine weiteren Angaben';
    ui.alarmAffected.textContent = formatAffected(alarm.affectedCount);
    ui.alarmCaller.textContent = alarm.caller || alarm.name || 'Nicht angegeben';
    ui.alarmQuestions.textContent = alarm.questions || alarm.additionalInfo || 'Keine weiteren Hinweise';
    ui.alarmId.textContent = alarm.alarmId || '–';
    ui.responseHint.textContent = 'Bitte Rückmeldung auswählen';
    ui.extraDetails.classList.add('is-hidden');
}

function formatAffected(value) {
    if (value === undefined || value === null || value === '') return 'Nicht angegeben';
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed === 1 ? '1 Person' : `${parsed} Personen`;
    return String(value);
}

function choose(response) {
    if (!currentAlarm) return;
    selectedResponse = response;

    // Der Zwischenstand wird absichtlich an die Leitstelle geschickt. Dort bleibt
    // die Einsatzkraft bis zum separaten 'confirmed' weiterhin als offen markiert.
    publishResponse(response);

    const coming = response === 'coming';
    ui.sheetIcon.textContent = coming ? '✓' : '×';
    ui.sheetIcon.classList.toggle('declined', !coming);
    ui.confirmText.textContent = coming
        ? 'Rückmeldung „KOMME“ wirklich an die Leitstelle senden?'
        : 'Rückmeldung „KOMME NICHT“ wirklich an die Leitstelle senden?';
    ui.confirmSheet.classList.remove('is-hidden');
}

function confirmResponse() {
    if (!currentAlarm || !selectedResponse) return;

    const finishedAlarm = currentAlarm;
    const finishedResponse = selectedResponse;
    stopAttention();
    publishResponse('confirmed');

    history.unshift({
        alarm: finishedAlarm,
        response: finishedResponse,
        confirmedAt: new Date(),
        superseded: false
    });

    ui.confirmSheet.classList.add('is-hidden');
    showToast(finishedResponse === 'coming' ? '✓ KOMME wurde bestätigt' : '✓ KOMME NICHT wurde bestätigt');
    currentAlarm = null;
    selectedResponse = null;
    renderHistory();
    showDashboard();
}

function cancelResponse() {
    selectedResponse = null;
    ui.confirmSheet.classList.add('is-hidden');
    ui.responseHint.textContent = 'Rückmeldung nicht bestätigt – weiterhin offen';
}

function renderHistory() {
    ui.alarmList.replaceChildren();
    ui.emptyState.classList.toggle('is-hidden', history.length > 0);

    history.forEach(item => {
        const alarm = item.alarm;
        const location = alarm.location || {};
        const address = [location.street, location.houseNumber, location.city].filter(Boolean).join(' ');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'alarm-card';

        const title = document.createElement('div');
        title.className = 'alarm-card-title';
        const keyword = document.createElement('span');
        keyword.textContent = alarm.keyword || 'Alarm';
        const time = document.createElement('span');
        time.className = 'alarm-card-time';
        time.textContent = item.confirmedAt
            ? item.confirmedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
            : '';
        title.append(keyword, time);

        const message = document.createElement('div');
        message.className = 'alarm-card-message';
        message.textContent = alarm.message || alarm.freeText || 'Keine weiteren Angaben';

        const addressEl = document.createElement('div');
        addressEl.className = 'alarm-card-address';
        addressEl.textContent = address || 'Einsatzort nicht angegeben';

        const status = document.createElement('div');
        status.className = 'alarm-card-status';
        status.textContent = item.response === 'coming'
            ? '✓ KOMME · BESTÄTIGT'
            : item.response === 'declined'
                ? '× KOMME NICHT · BESTÄTIGT'
                : 'OHNE RÜCKMELDUNG';

        button.append(title, message, addressEl, status);
        button.addEventListener('click', () => showHistoricalAlarm(item));
        ui.alarmList.appendChild(button);
    });
}

function showHistoricalAlarm(item) {
    fillAlarm(item.alarm);
    ui.responseHint.textContent = item.response === 'coming'
        ? 'Rückmeldung: KOMME · bestätigt'
        : item.response === 'declined'
            ? 'Rückmeldung: KOMME NICHT · bestätigt'
            : 'Keine Rückmeldung';
    ui.btnComing.disabled = true;
    ui.btnDeclined.disabled = true;
    ui.screenTitle.textContent = 'Alarmdetails';
    ui.screenSubtitle.textContent = 'Archivierter Alarm';
    ui.backButton.classList.remove('is-hidden');
    ui.dashboardScreen.classList.add('is-hidden');
    ui.alarmScreen.classList.remove('is-hidden');
    ui.mapScreen.classList.add('is-hidden');
    setActiveNav('alarms');
}

function showDashboard() {
    ui.screenTitle.textContent = 'Alarmliste';
    ui.screenSubtitle.textContent = 'aPager PRO';
    ui.backButton.classList.add('is-hidden');
    ui.dashboardScreen.classList.remove('is-hidden');
    ui.alarmScreen.classList.add('is-hidden');
    ui.mapScreen.classList.add('is-hidden');
    setActiveNav('alarms');
    ui.btnComing.disabled = false;
    ui.btnDeclined.disabled = false;
    renderHistory();
}

function showAlarm() {
    ui.screenTitle.textContent = 'Alarmdetails';
    ui.screenSubtitle.textContent = 'Neue Alarmierung';
    ui.backButton.classList.remove('is-hidden');
    ui.dashboardScreen.classList.add('is-hidden');
    ui.alarmScreen.classList.remove('is-hidden');
    ui.mapScreen.classList.add('is-hidden');
    setActiveNav('alarms');
    ui.btnComing.disabled = false;
    ui.btnDeclined.disabled = false;
    ui.alarmScreen.scrollTop = 0;
}

function showToast(text) {
    clearTimeout(toastTimer);
    ui.toast.textContent = text;
    ui.toast.classList.remove('is-hidden');
    toastTimer = setTimeout(() => ui.toast.classList.add('is-hidden'), 2800);
}

function setActiveNav(name) {
    ui.navAlarms.classList.toggle('active', name === 'alarms');
    ui.navMap.classList.toggle('active', name === 'map');
}

function currentMapAlarm() {
    if (currentAlarm) return currentAlarm;
    return history.length ? history[0].alarm : null;
}

async function showMapForAlarm(alarm) {
    ui.dashboardScreen.classList.add('is-hidden');
    ui.alarmScreen.classList.add('is-hidden');
    ui.mapScreen.classList.remove('is-hidden');
    ui.backButton.classList.remove('is-hidden');
    ui.screenTitle.textContent = 'Einsatzort';
    ui.screenSubtitle.textContent = 'Kartenansicht';
    setActiveNav('map');

    ui.mapFrame.classList.add('is-hidden');
    ui.mapError.classList.add('is-hidden');
    ui.mapLoading.classList.remove('is-hidden');

    if (!alarm) {
        ui.mapAddress.textContent = 'Kein aktiver Einsatz';
        ui.mapLoading.classList.add('is-hidden');
        ui.mapErrorText.textContent = 'Es liegt derzeit kein Einsatz mit Adresse vor.';
        ui.mapError.classList.remove('is-hidden');
        return;
    }

    const location = alarm.location || {};
    const address = [location.street, location.houseNumber, location.city].filter(Boolean).join(' ');
    ui.mapAddress.textContent = address || 'Einsatzort nicht angegeben';

    if (!address) {
        ui.mapLoading.classList.add('is-hidden');
        ui.mapErrorText.textContent = 'Für diesen Einsatz wurde keine Adresse übermittelt.';
        ui.mapError.classList.remove('is-hidden');
        return;
    }

    try {
        ui.mapLoadingText.textContent = 'Einsatzort wird gesucht …';

        let coords = geocodeCache.get(address);
        if (!coords) {
            if (mapAbortController) mapAbortController.abort();
            mapAbortController = new AbortController();
            const timeout = setTimeout(() => mapAbortController.abort(), 5000);

            const query = new URLSearchParams({
                format: 'jsonv2',
                limit: '1',
                street: [location.houseNumber, location.street].filter(Boolean).join(' '),
                city: location.city || '',
                countrycodes: 'de'
            });

            let response = await fetch(`https://nominatim.openstreetmap.org/search?${query.toString()}`, {
                signal: mapAbortController.signal,
                headers: { 'Accept': 'application/json' }
            });

            clearTimeout(timeout);

            if (!response.ok) throw new Error('Geocoding fehlgeschlagen');
            let results = await response.json();

            if (!results.length) {
                const fallback = new URLSearchParams({
                    format: 'jsonv2',
                    limit: '1',
                    q: address,
                    countrycodes: 'de'
                });
                response = await fetch(`https://nominatim.openstreetmap.org/search?${fallback.toString()}`, {
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) throw new Error('Geocoding fehlgeschlagen');
                results = await response.json();
            }

            if (!results.length) throw new Error('Adresse nicht gefunden');

            coords = {
                lat: Number(results[0].lat),
                lon: Number(results[0].lon)
            };
            geocodeCache.set(address, coords);
        }

        const deltaLat = 0.0065;
        const deltaLon = 0.0105;
        const left = coords.lon - deltaLon;
        const right = coords.lon + deltaLon;
        const bottom = coords.lat - deltaLat;
        const top = coords.lat + deltaLat;

        const params = new URLSearchParams({
            bbox: `${left},${bottom},${right},${top}`,
            layer: 'mapnik',
            marker: `${coords.lat},${coords.lon}`
        });

        ui.mapLoadingText.textContent = 'Kartenbild wird geladen …';
        ui.mapFrame.onload = () => {
            ui.mapLoading.classList.add('is-hidden');
            ui.mapFrame.classList.remove('is-hidden');
        };
        ui.mapFrame.src = `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;

        // Falls der iframe nicht sauber meldet, bleibt die UI trotzdem bedienbar.
        setTimeout(() => {
            if (!ui.mapFrame.classList.contains('is-hidden')) return;
            ui.mapLoading.classList.add('is-hidden');
            ui.mapFrame.classList.remove('is-hidden');
        }, 2500);

    } catch (err) {
        ui.mapLoading.classList.add('is-hidden');
        ui.mapFrame.classList.add('is-hidden');
        ui.mapErrorText.textContent = err && err.name === 'AbortError'
            ? 'Die Kartensuche hat zu lange gedauert.'
            : 'Der Einsatzort konnte nicht auf der Karte geladen werden.';
        ui.mapError.classList.remove('is-hidden');
    }
}

function openNavigation() {
    showMapForAlarm(currentMapAlarm());
}

ui.btnOpenAlarm.addEventListener('click', openCurrentAlarm);
ui.btnComing.addEventListener('click', () => choose('coming'));
ui.btnDeclined.addEventListener('click', () => choose('declined'));
ui.btnConfirm.addEventListener('click', confirmResponse);
ui.btnCancel.addEventListener('click', cancelResponse);
ui.confirmSheet.addEventListener('click', event => {
    if (event.target === ui.confirmSheet) cancelResponse();
});
ui.detailsButton.addEventListener('click', () => ui.extraDetails.classList.toggle('is-hidden'));
ui.navigationButton.addEventListener('click', openNavigation);
ui.backButton.addEventListener('click', () => {
    if (!ui.mapScreen.classList.contains('is-hidden')) {
        if (currentAlarm) showAlarm();
        else showDashboard();
        return;
    }
    if (currentAlarm) {
        showToast('Der aktuelle Alarm bleibt geöffnet, bis eine Rückmeldung bestätigt wurde.');
        return;
    }
    showDashboard();
});
ui.navAlarms.addEventListener('click', () => {
    if (currentAlarm) showAlarm();
    else showDashboard();
});
ui.navMap.addEventListener('click', () => {
    showMapForAlarm(currentMapAlarm());
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateClock();
});

mqtt.connect();
