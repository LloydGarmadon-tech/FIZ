const cfg = window.FIZ_CONFIG;
const deviceId = sessionStorage.getItem('dmeDeviceId') || `dme-${Math.floor(Math.random() * 1000).toString().padStart(3,'0')}`;
sessionStorage.setItem('dmeDeviceId', deviceId);

const messageArea = document.querySelector('.textarea');
const monitor = document.querySelector('.window');
const btnYellow = document.querySelector('.btnYellow');
const btnUp = document.querySelector('.btnUp');
const btnDown = document.querySelector('.btnDown');
const connectionState = document.getElementById('connectionState');
const audioManager = new AudioManager({ alarm: '../assets/audio/quattro2.wav' });

let currentAlarm = null;
let clearTimer = null;
let messageLines = [];
let lineOffset = 0;
let visibleLineCount = 1;
let alarmAcknowledged = false;

const mqtt = new FizMqttClient({
    ...cfg.mqtt,
    clientId: deviceId,
    willTopic: `${cfg.topics.deviceStatusPrefix}/dme/${deviceId}/status`,
    willPayload: { type:'status', deviceType:'dme', deviceId, status:'offline', timestamp:new Date().toISOString() },
    willRetained: true,
    onStateChange: (connected) => {
        if (connectionState) connectionState.textContent = connected ? '● online' : '● offline';
    },
    onConnect: () => {
        mqtt.subscribe(cfg.topics.alarmNew);
        publishStatus('online');
        showIdle();
    },
    onMessage: (topic, payload) => {
        if (topic === cfg.topics.alarmNew && payload && payload.type === 'alarm') receiveAlarm(payload);
    }
});

function deviceTopic(kind) {
    return `${cfg.topics.deviceStatusPrefix}/dme/${deviceId}/${kind}`;
}

function publishStatus(status) {
    try {
        mqtt.publish(deviceTopic('status'), {
            type: 'status',
            deviceType: 'dme',
            deviceId,
            status,
            timestamp: new Date().toISOString()
        }, true);
    } catch (_) { }
}

function publishResponse(response) {
    if (!currentAlarm) return;

    try {
        mqtt.publish(deviceTopic('response'), {
            type: 'response',
            deviceType: 'dme',
            deviceId,
            alarmId: currentAlarm.alarmId,
            response,
            timestamp: new Date().toISOString()
        });
    } catch (_) { }
}

function receiveAlarm(alarm) {
    currentAlarm = alarm;
    alarmAcknowledged = false;
    clearTimeout(clearTimer);

    monitor.style.background = '#e97b00';
    prepareMessage(FizAlarm.alarmToDisplayText(alarm));

    audioManager.play('alarm', true);
    publishResponse('received');
}

/**
 * Zerlegt die Meldung anhand der realen Displaybreite in Bildschirmzeilen.
 * Dadurch funktionieren Hoch/Runter unabhängig von Fenstergröße und Zoom.
 */
function prepareMessage(text) {
    lineOffset = 0;
    messageLines = wrapTextForDisplay(text);
    updateVisibleLineCount();
    renderMessagePage();
}

function wrapTextForDisplay(text) {
    const style = window.getComputedStyle(messageArea);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = font;

    const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const maxWidth = Math.max(20, messageArea.clientWidth - horizontalPadding - 2);
    const output = [];

    String(text || '').split('\n').forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) {
            output.push('');
            return;
        }

        const words = line.split(/\s+/);
        let current = '';

        words.forEach(word => {
            const candidate = current ? `${current} ${word}` : word;

            if (context.measureText(candidate).width <= maxWidth) {
                current = candidate;
                return;
            }

            if (current) output.push(current);

            // Sehr lange Einzelwörter notfalls zeichenweise umbrechen.
            if (context.measureText(word).width > maxWidth) {
                let fragment = '';
                for (const char of word) {
                    const next = fragment + char;
                    if (fragment && context.measureText(next).width > maxWidth) {
                        output.push(fragment);
                        fragment = char;
                    } else {
                        fragment = next;
                    }
                }
                current = fragment;
            } else {
                current = word;
            }
        });

        if (current) output.push(current);
    });

    return output.length ? output : [''];
}

function updateVisibleLineCount() {
    const style = window.getComputedStyle(messageArea);
    let lineHeight = parseFloat(style.lineHeight);

    if (!Number.isFinite(lineHeight)) {
        lineHeight = parseFloat(style.fontSize) * 1.12;
    }

    const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    visibleLineCount = Math.max(1, Math.floor((messageArea.clientHeight - verticalPadding) / lineHeight));
}

function renderMessagePage() {
    if (!currentAlarm) return;

    updateVisibleLineCount();
    const maxOffset = Math.max(0, messageLines.length - visibleLineCount);
    lineOffset = Math.max(0, Math.min(lineOffset, maxOffset));

    messageArea.textContent = messageLines
        .slice(lineOffset, lineOffset + visibleLineCount)
        .join('\n');

    btnUp.disabled = lineOffset === 0;
    btnDown.disabled = lineOffset >= maxOffset;
}

function navigateUp() {
    if (!currentAlarm || lineOffset <= 0) return;
    lineOffset--;
    renderMessagePage();
}

function navigateDown() {
    if (!currentAlarm) return;

    const maxOffset = Math.max(0, messageLines.length - visibleLineCount);
    if (lineOffset >= maxOffset) return;

    lineOffset++;
    renderMessagePage();
}

function acknowledge() {
    if (!currentAlarm || alarmAcknowledged) return;

    alarmAcknowledged = true;
    audioManager.stop('alarm');
    publishResponse('acknowledged');

    // Meldung bleibt noch kurz sichtbar, damit die Quittierung nachvollziehbar ist.
    clearTimer = setTimeout(showIdle, 5000);
}

function showIdle() {
    clearTimeout(clearTimer);
    audioManager.stop('alarm');
    monitor.style.background = '';
    messageArea.textContent = 'FF Lauenburg';
    currentAlarm = null;
    alarmAcknowledged = false;
    messageLines = [];
    lineOffset = 0;
    btnUp.disabled = true;
    btnDown.disabled = true;
}

btnYellow.addEventListener('click', acknowledge);
btnUp.addEventListener('click', navigateUp);
btnDown.addEventListener('click', navigateDown);

// Bei Größenänderungen wird die Meldung passend zur neuen Displaygröße neu umbrochen.
window.addEventListener('resize', () => {
    if (!currentAlarm) return;
    messageLines = wrapTextForDisplay(FizAlarm.alarmToDisplayText(currentAlarm));
    renderMessagePage();
});

mqtt.connect();
