/**
 * ObservationPoint — Audio Recorder Module
 * Handles MediaRecorder, timer, waveform visualization,
 * and sends audio to the server for transcription.
 */

class ObservationRecorder {
    constructor(options = {}) {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.isRecording = false;
        this.isPaused = false;
        this.seconds = 0;
        this.timerInterval = null;
        this.analyser = null;
        this.animationFrame = null;

        // Callbacks
        this.onStateChange = options.onStateChange || (() => {});
        this.onTimerUpdate = options.onTimerUpdate || (() => {});
        this.onWaveformData = options.onWaveformData || (() => {});
        this.onTranscriptReady = options.onTranscriptReady || (() => {});
        this.onError = options.onError || ((err) => console.error('Recorder error:', err));

        // Auto-save chunks every 30 seconds to localStorage
        this.autoSaveInterval = null;
    }

    /**
     * Request microphone access and initialize recorder
     */
    async init() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000,
                }
            });

            // Set up analyser for waveform visualization
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(this.stream);
            this.analyser = audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);

            // Determine best supported format
            const mimeType = this._getBestMimeType();

            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: mimeType,
                audioBitsPerSecond: 128000,
            });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this._stopWaveform();
            };

            return true;
        } catch (err) {
            this.onError(err);
            return false;
        }
    }

    /**
     * Start or resume recording
     */
    start() {
        if (!this.mediaRecorder) {
            this.onError(new Error('Recorder not initialized. Call init() first.'));
            return;
        }

        if (this.isPaused) {
            this.mediaRecorder.resume();
            this.isPaused = false;
        } else {
            this.audioChunks = [];
            this.seconds = 0;
            this.mediaRecorder.start(1000); // Collect data every second
        }

        this.isRecording = true;
        this._startTimer();
        this._startWaveform();
        this.onStateChange('recording');
    }

    /**
     * Pause recording
     */
    pause() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.pause();
            this.isPaused = true;
            this.isRecording = false;
            this._stopTimer();
            this._stopWaveform();
            this.onStateChange('paused');
        }
    }

    /**
     * Toggle between recording and paused
     */
    toggle() {
        if (this.isRecording) {
            this.pause();
        } else {
            this.start();
        }
    }

    /**
     * Stop recording and return audio blob
     */
    async stop() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = () => {
                const mimeType = this.mediaRecorder.mimeType;
                const blob = new Blob(this.audioChunks, { type: mimeType });
                this.isRecording = false;
                this.isPaused = false;
                this._stopTimer();
                this._stopWaveform();
                this.onStateChange('stopped');
                resolve(blob);
            };

            this.mediaRecorder.stop();
        });
    }

    /**
     * Stop and clean up all resources
     */
    destroy() {
        this._stopTimer();
        this._stopWaveform();
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }
        this.mediaRecorder = null;
        this.stream = null;
        this.audioChunks = [];
    }

    /**
     * Get the recorded audio as a Blob
     */
    getBlob() {
        if (this.audioChunks.length === 0) return null;
        return new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
    }

    /**
     * Get duration in seconds
     */
    getDuration() {
        return this.seconds;
    }

    /**
     * Get formatted time string (MM:SS)
     */
    getTimeFormatted() {
        const m = Math.floor(this.seconds / 60).toString().padStart(2, '0');
        const s = (this.seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    /**
     * Send audio to server for transcription
     */
    async transcribe() {
        const blob = this.getBlob();
        if (!blob) {
            this.onError(new Error('No audio to transcribe'));
            return null;
        }

        const formData = new FormData();
        formData.append('audio', blob, 'observation.webm');

        try {
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Transcription failed: ${response.status}`);
            }

            const result = await response.json();
            this.onTranscriptReady(result);
            return result;
        } catch (err) {
            this.onError(err);
            return null;
        }
    }

    // --- Private methods ---

    _getBestMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ];
        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return '';
    }

    _startTimer() {
        this._stopTimer();
        this.timerInterval = setInterval(() => {
            this.seconds++;
            this.onTimerUpdate(this.getTimeFormatted(), this.seconds);
        }, 1000);
    }

    _stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    _startWaveform() {
        if (!this.analyser) return;
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            this.animationFrame = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);
            // Send normalized values (0-1) for the first 7 bands
            const bands = [];
            const bandSize = Math.floor(bufferLength / 7);
            for (let i = 0; i < 7; i++) {
                let sum = 0;
                for (let j = i * bandSize; j < (i + 1) * bandSize; j++) {
                    sum += dataArray[j];
                }
                bands.push((sum / bandSize) / 255);
            }
            this.onWaveformData(bands);
        };

        draw();
    }

    _stopWaveform() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }
}

// Auto-save observation data to localStorage
const ObservationAutoSave = {
    KEY: 'observationpoint_draft',

    save(data) {
        try {
            data._savedAt = new Date().toISOString();
            localStorage.setItem(this.KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('Auto-save failed:', e);
        }
    },

    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    clear() {
        localStorage.removeItem(this.KEY);
    },

    hasDraft() {
        return !!localStorage.getItem(this.KEY);
    }
};
