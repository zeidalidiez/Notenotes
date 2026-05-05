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
    this._source = null;
    this._analyser = null;
    this._chunks = [];
    this._isRecording = false;
    this._hasPermission = false;
    this._animFrame = null;
    this._onRecordingComplete = null;
    this._devices = [];
    this._selectedDeviceId = '';
  }

  setRecordingCallback(fn) { this._onRecordingComplete = fn; }

  render() {
    this.el = document.createElement('div');
    this.el.className = 'mic-recorder';
    this.el.id = 'mic-recorder';
    this.el.innerHTML = `
      <div class="mic-recorder__visual">
        <canvas class="mic-recorder__meter" id="mic-meter" width="280" height="120"></canvas>
        <div class="mic-recorder__status" id="mic-status">Tap to enable audio input</div>
      </div>
      <div class="mic-recorder__device-row">
        <label class="mic-recorder__device-label" for="mic-device-select">Input</label>
        <select class="mic-recorder__device-select" id="mic-device-select" aria-label="Audio input device">
          <option value="">Default input</option>
        </select>
      </div>
      <div class="mic-recorder__controls">
        <button class="btn btn--record mic-recorder__btn" id="mic-btn" aria-label="Record audio input">
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

    this.el.querySelector('#mic-device-select')?.addEventListener('change', async (e) => {
      this._selectedDeviceId = e.target.value;
      if (this._hasPermission) {
        await this._openStream();
      }
    });
  }

  async _requestPermission() {
    const status = this.el.querySelector('#mic-status');
    try {
      status.textContent = 'Requesting audio input access...';
      await this._openStream();
      this._hasPermission = true;
      await this._refreshDeviceList();
      status.textContent = 'Audio input ready. Tap to record.';
    } catch (err) {
      status.textContent = 'Audio input access denied';
      console.warn('[MicRecorder] Permission denied:', err);
    }
  }

  async _openStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media input is not available in this browser');
    }

    const constraints = {
      audio: this._selectedDeviceId
        ? { deviceId: { exact: this._selectedDeviceId } }
        : true,
    };

    this._stopStream();
    this._stream = await navigator.mediaDevices.getUserMedia(constraints);
    this._setupAnalyser();
  }

  _setupAnalyser() {
    if (!this.engine.ctx || !this._stream) return;

    this._source = this.engine.ctx.createMediaStreamSource(this._stream);
    this._analyser = this.engine.ctx.createAnalyser();
    this._analyser.fftSize = 256;
    this._source.connect(this._analyser);

    if (!this._animFrame) {
      this._drawMeter();
    }
  }

  async _refreshDeviceList() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    this._devices = (await navigator.mediaDevices.enumerateDevices())
      .filter(d => d.kind === 'audioinput');

    const select = this.el?.querySelector('#mic-device-select');
    if (!select) return;

    const current = this._selectedDeviceId;
    select.innerHTML = `
      <option value="">Default input</option>
      ${this._devices.map((d, i) => `
        <option value="${d.deviceId}" ${d.deviceId === current ? 'selected' : ''}>
          ${d.label || `Audio input ${i + 1}`}
        </option>
      `).join('')}
    `;
    select.value = current;
  }

  _startRecording() {
    if (!this._stream) {
      this._requestPermission().then(() => {
        if (this._stream) this._startRecording();
      });
      return;
    }
    this._chunks = [];
    this._startTime = Date.now();
    const mimeType = this._preferredMimeType();
    this._recorder = mimeType
      ? new MediaRecorder(this._stream, { mimeType })
      : new MediaRecorder(this._stream);
    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };
    this._recorder.onerror = (e) => {
      console.warn('[MicRecorder] Recording error:', e.error || e);
      this.el.querySelector('#mic-status').textContent = 'Audio recording failed';
    };
    this._recorder.onstop = () => {
      const blob = new Blob(this._chunks, { type: this._recorder?.mimeType || mimeType || 'audio/webm' });
      this._chunks = [];
      if (!blob.size) {
        this.el.querySelector('#mic-status').textContent = 'No audio was captured. Try recording again.';
        return;
      }
      if (this._onRecordingComplete) this._onRecordingComplete(blob);
    };
    this._recorder.start(250);
    this._isRecording = true;
    this.el.querySelector('#mic-btn').classList.add('is-active');
    this.el.querySelector('#mic-status').textContent = 'Recording...';
  }

  _stopRecording() {
    if (this._recorder && this._recorder.state === 'recording') {
      try { this._recorder.requestData(); } catch (_) {}
      this._recorder.stop();
    }
    this._isRecording = false;
    this.el.querySelector('#mic-btn').classList.remove('is-active');
    this.el.querySelector('#mic-status').textContent = 'Audio input ready. Tap to record.';
  }

  _drawMeter() {
    const canvas = this.el.querySelector('#mic-meter');
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    const analyser = this._analyser;
    if (!analyser) return;
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    const barCount = 28;
    const silenceFloor = 0.012;

    const draw = () => {
      if (!this._analyser) return;
      this._animFrame = requestAnimationFrame(draw);
      this._analyser.getByteTimeDomainData(dataArray);

      canvasCtx.fillStyle = '#141414';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const centered = (dataArray[i] - 128) / 128;
        sumSquares += centered * centered;
      }

      const rms = Math.sqrt(sumSquares / bufferLength);
      const level = Math.min(1, Math.max(0, (rms - silenceFloor) / 0.16));
      const center = canvas.height / 2;
      const barWidth = canvas.width / barCount;

      canvasCtx.strokeStyle = 'rgba(255,255,255,0.12)';
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, center);
      canvasCtx.lineTo(canvas.width, center);
      canvasCtx.stroke();

      for (let i = 0; i < barCount; i++) {
        const phase = Math.sin((i / (barCount - 1)) * Math.PI);
        const height = Math.max(2, phase * level * (canvas.height - 18));
        const x = i * barWidth + 1.5;
        const y = center - height / 2;
        const lightness = 34 + level * 36;
        canvasCtx.fillStyle = `hsl(0, 0%, ${lightness}%)`;
        canvasCtx.fillRect(x, y, Math.max(2, barWidth - 3), height);
      }
    };
    draw();
  }

  _stopStream() {
    if (this._isRecording) this._stopRecording();
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    this._source = null;
    this._analyser = null;
  }

  _preferredMimeType() {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
    ];
    if (!window.MediaRecorder?.isTypeSupported) return '';
    return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  destroy() {
    this._stopStream();
  }
}
