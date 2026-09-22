(function () {
    function createAlarm(data) {
        return {
            type: "alarm",
            version: 2,
            alarmId: crypto.randomUUID ? crypto.randomUUID() : `alarm-${Date.now()}`,
            timestamp: new Date().toISOString(),
            keyword: String(data.keyword || "").trim(),
            location: {
                street: String(data.street || "").trim(),
                houseNumber: String(data.houseNumber || "").trim(),
                city: String(data.city || "").trim()
            },
            caller: String(data.caller || "").trim(),
            affectedCount: data.affectedCount === "" || data.affectedCount == null ? null : Number(data.affectedCount),
            message: String(data.message || "").trim(),
            callbackNotes: String(data.callbackNotes || "").trim()
        };
    }

    function alarmToDisplayText(alarm) {
        return [
            alarm.keyword,
            [alarm.location && alarm.location.street, alarm.location && alarm.location.houseNumber].filter(Boolean).join(" "),
            alarm.location && alarm.location.city,
            alarm.affectedCount != null ? `Betroffene: ${alarm.affectedCount}` : "",
            alarm.caller,
            alarm.message,
            alarm.callbackNotes
        ].filter(Boolean).join("\n");
    }

    window.FizAlarm = { createAlarm, alarmToDisplayText };
})();
