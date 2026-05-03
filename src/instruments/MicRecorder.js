/**
 * MicRecorder — Captures audio from the device microphone.
 * Uses MediaRecorder API for recording and Web Audio for level metering.
 */

import { AudioEngine } from '../engine/AudioEngine.js';

export class MicRecorder {
  constructor() {
    this.engine = AudioEngine.getInstance();
    this.el = null;
    this._stream = null;
    this._recorder = null;
    this._analyser = null;
    this._chunks = [];
    this._isRecording = false;
    this._hasPermission = false;
    this._animFrame = null;
    this._onRecordingComplete = null;
  }

  setRecordingCallback(fn) { this._onRecordingComplete = fn; }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'mic-recorder';
    this.el.id = 'mic-recorder';
    this.el.innerHTML = `
      <div class="mic-recorder__visual">
        <canvas class="mic-recorder__meter" id="mic-meter" width="280" height="120"></canvas>
        <div class="mic-recorder__status" id="mic-status">Tap to enable microphone</div>
      </div>
      <div class="mic-recorder__controls">
        <button class="btn btn--record mic-recorder__btn" id="mic-btn" aria-label="Record from microphone">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
      </div>`;
    this._bindEvents();
    return this.el;
  }

  _bindEvents() {
    this.el.querySelector('#mic-btn').addEventListener('pointerdown', async (e) => {
      e.preventDefault();
      if (!this._hasPermission) {
        await this._requestPermission();
        return;
      }
      if (this._isRecording) {
        this._stopRecording();
      } else {
        this._startRecording();
      }
    });
  }

  async _requestPermission() {
    const status = this.el.querySelector('#mic-status');
    try {
      status.textContent = 'Requesting mic access...';
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._hasPermission = true;
      status.textContent = 'Mic ready. Tap to record.';

      // Set up analyser for level meter
      const source = this.engine.ctx.createMediaStreamSource(this._stream);
      this._analyser = this.engine.ctx.createAnalyser();
      this._analyser.fftSize = 256;
      source.connect(this._analyser);
      this._drawMeter();
    } catch (err) {
      status.textContent = 'Mic access denied';
      console.warn('[MicRecorder] Permission denied:', err);
    }
  }

  _startRecording() {
    if (!this._stream) return;
    this._chunks = [];
    this._startTime = Date.now();
    this._recorder = new MediaRecorder(this._stream, { mimeType: 'audio/webm;codecs=opus' });
    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder.onstop = () => {
      const blob = new Blob(this._chunks, { type: 'audio/webm' });
      this._chunks = [];
      if (this._onRecordingComplete) this._onRecordingComplete(blob);
    };
    this._recorder.start();
    this._isRecording = true;
    this.el.querySelector('#mic-btn').classList.add('is-active');
    this.el.querySelector('#mic-status').textContent = 'Recording...';
  }

  _stopRecording() {
    if (this._recorder && this._recorder.state === 'recording') {
      this._recorder.stop();
    }
    this._isRecording = false;
    this.el.querySelector('#mic-btn').classList.remove('is-active');
    this.el.querySelector('#mic-status').textContent = 'Mic ready. Tap to record.';
  }

  _drawMeter() {
    const canvas = this.el.querySelector('#mic-meter');
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    const bufferLength = this._analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      this._animFrame = requestAnimationFrame(draw);
      this._analyser.getByteFrequencyData(dataArray);

      canvasCtx.fillStyle = '#141414';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        const hue = 0;
        const lightness = 40 + (dataArray[i] / 255) * 30;
        canvasCtx.fillStyle = `hsl(${hue}, 0%, ${lightness}%)`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
    }
  }
}
