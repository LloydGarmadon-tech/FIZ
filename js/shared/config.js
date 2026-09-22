/**
 * Public FIZ configuration.
 *
 * Do NOT store private API keys in this file. Local keys belong in
 * config.local.js, which is excluded from Git by .gitignore.
 */
window.FIZ_CONFIG = {
    map: {
        provider: "maptiler",
        mapTilerKey: "",
        style: "streets",
        defaultZoom: 14
    },
    routing: {
        provider: "openrouteservice",
        openRouteServiceKey: "",
        endpoint: "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
        preference: "fastest"
    },
    mqtt: {
        host: "broker.emqx.io",
        port: 8083,
        path: "/mqtt",
        useSSL: false,
        reconnectInitialMs: 2000,
        reconnectMaxMs: 30000,
        connectTimeoutSeconds: 8
    },
    topics: {
        alarmNew: "feuerwehr/alarm/new",
        alarmCancel: "feuerwehr/alarm/cancel",
        deviceStatusPrefix: "feuerwehr/devices",
        leitstelleStatus: "feuerwehr/leitstelle/status",
        vehicleStatusPrefix: "feuerwehr/vehicles"
    }
};
