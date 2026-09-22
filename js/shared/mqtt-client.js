(function () {
    class FizMqttClient {
        constructor(options) {
            this.options = options;
            this.client = null;
            this.connected = false;
            this.reconnectTimer = null;
            this.reconnectDelay = options.reconnectInitialMs || 2000;
            this.manualDisconnect = false;
            this.subscriptions = new Set();
        }

        connect() {
            if (this.connected || (this.client && this.client.isConnected && this.client.isConnected())) return;
            this.manualDisconnect = false;
            const clientId = this.options.clientId || `fiz-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
            this.client = new Paho.MQTT.Client(
                this.options.host,
                Number(this.options.port),
                this.options.path || "/mqtt",
                clientId
            );
            this.client.onConnectionLost = (response) => this.handleConnectionLost(response);
            this.client.onMessageArrived = (message) => this.handleMessage(message);
            const connectOptions = {
                useSSL: !!this.options.useSSL,
                cleanSession: true,
                timeout: this.options.connectTimeoutSeconds || 8,
                onSuccess: () => this.handleConnected(),
                onFailure: (error) => this.handleFailure(error)
            };
            // Optionaler MQTT Last-Will: damit die Leitstelle auch einen abrupten
            // Verbindungsverlust eines Teilnehmers protokollieren kann.
            if (this.options.willTopic && this.options.willPayload) {
                const body = typeof this.options.willPayload === "string"
                    ? this.options.willPayload
                    : JSON.stringify(this.options.willPayload);
                const will = new Paho.MQTT.Message(body);
                will.destinationName = this.options.willTopic;
                will.retained = this.options.willRetained !== false;
                connectOptions.willMessage = will;
            }
            this.client.connect(connectOptions);
        }

        disconnect() {
            this.manualDisconnect = true;
            clearTimeout(this.reconnectTimer);
            if (this.client && this.client.isConnected()) this.client.disconnect();
            this.connected = false;
        }

        subscribe(topic) {
            this.subscriptions.add(topic);
            if (this.connected) this.client.subscribe(topic);
        }

        publish(topic, data, retained = false) {
            if (!this.connected || !this.client || !this.client.isConnected()) {
                throw new Error("MQTT ist nicht verbunden.");
            }
            const body = typeof data === "string" ? data : JSON.stringify(data);
            const message = new Paho.MQTT.Message(body);
            message.destinationName = topic;
            message.retained = retained;
            this.client.send(message);
        }

        handleConnected() {
            this.connected = true;
            this.reconnectDelay = this.options.reconnectInitialMs || 2000;
            this.subscriptions.forEach((topic) => this.client.subscribe(topic));
            if (this.options.onStateChange) this.options.onStateChange(true, "Verbunden");
            if (this.options.onConnect) this.options.onConnect();
        }

        handleFailure(error) {
            this.connected = false;
            const detail = error && error.errorMessage ? error.errorMessage : "Verbindung fehlgeschlagen";
            if (this.options.onStateChange) this.options.onStateChange(false, detail);
            this.scheduleReconnect();
        }

        handleConnectionLost(response) {
            this.connected = false;
            const detail = response && response.errorMessage ? response.errorMessage : "Verbindung verloren";
            if (this.options.onStateChange) this.options.onStateChange(false, detail);
            if (!this.manualDisconnect) this.scheduleReconnect();
        }

        scheduleReconnect() {
            if (this.manualDisconnect || this.reconnectTimer) return;
            if (this.options.onReconnectScheduled) this.options.onReconnectScheduled(this.reconnectDelay);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                this.connect();
            }, this.reconnectDelay);
            this.reconnectDelay = Math.min(
                this.reconnectDelay * 2,
                this.options.reconnectMaxMs || 30000
            );
        }

        handleMessage(message) {
            if (!this.options.onMessage) return;
            let parsed = message.payloadString;
            try { parsed = JSON.parse(message.payloadString); } catch (_) { }
            this.options.onMessage(message.destinationName, parsed, message.payloadString);
        }
    }

    window.FizMqttClient = FizMqttClient;
})();
