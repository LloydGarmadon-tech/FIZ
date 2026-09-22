(function () {
    class AudioManager {
        constructor(soundMap) {
            this.sounds = {};
            Object.entries(soundMap || {}).forEach(([name, path]) => {
                this.sounds[name] = new Audio(path);
                this.sounds[name].preload = "auto";
            });
        }

        play(name, loop = false) {
            const audio = this.sounds[name];
            if (!audio) return Promise.resolve();
            audio.pause();
            audio.currentTime = 0;
            audio.loop = loop;
            return audio.play().catch((error) => {
                console.warn(`Sound '${name}' konnte nicht automatisch abgespielt werden.`, error);
            });
        }

        stop(name) {
            const audio = this.sounds[name];
            if (!audio) return;
            audio.pause();
            audio.currentTime = 0;
        }
    }

    window.AudioManager = AudioManager;
})();
