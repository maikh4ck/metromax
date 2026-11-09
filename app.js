(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const tempoInput = $('#tempoInput');
  const tempoSlider = $('#tempoSlider');
  const volumeSlider = $('#volumeSlider');
  const panSlider = $('#panSlider');
  const playButton = $('#playButton');
  const playLabel = $('#playLabel');
  const playIcon = $('#playIcon');
  const statusText = $('#statusText');
  const statusDot = $('#statusDot');
  const visualizer = $('#visualizer');
  const beatOrb = $('#beatOrb');

  let audioContext;
  let masterGain;
  let panner;
  let isPlaying = false;
  let timerId;
  let nextNoteTime = 0;
  let beatNumber = 0;
  let activeTempo = 120;
  let pendingTempo = null;
  let subdivision = 1;
  let sound = 'studio';
  let accentEnabled = false;
  let previousVolume = 75;
  let tapTimes = [];
  let visualTimers = new Set();
  const lookaheadMs = 25;
  const scheduleAheadSeconds = 0.04;
  const beatsPerBar = 4;
  const settingsKey = 'ritmo-metronomo-settings-v1';

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function bpm() { return Number(tempoInput.value) || 120; }

  function updateRange(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty('--range-progress', `${((value - min) / (max - min)) * 100}%`);
  }

  function setTempo(value) {
    const next = clamp(Math.round(Number(value) || 120), 30, 300);
    tempoInput.value = next;
    tempoSlider.value = next;
    updateRange(tempoSlider);
    if (isPlaying) pendingTempo = next;
  }

  function readSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      return {
        volume: clamp(Number.isFinite(Number(stored.volume)) ? Number(stored.volume) : 75, 0, 100),
        pan: clamp(Number.isFinite(Number(stored.pan)) ? Number(stored.pan) : 0, -100, 100),
        accentEnabled: stored.accentEnabled === true,
      };
    } catch {
      return { volume: 75, pan: 0, accentEnabled: false };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify({
        volume: Number(volumeSlider.value),
        pan: Number(panSlider.value),
        accentEnabled,
      }));
    } catch { /* El metrónomo sigue funcionando si el navegador bloquea el almacenamiento local. */ }
  }

  function ensureAudio() {
    if (audioContext) {
      if (audioContext.state === 'suspended') audioContext.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      statusText.textContent = 'AUDIO NO DISPONIBLE';
      return;
    }
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    if (audioContext.createStereoPanner) {
      panner = audioContext.createStereoPanner();
      panner.pan.value = Number(panSlider.value) / 100;
      panner.connect(masterGain);
    } else {
      panner = null;
    }
    masterGain.gain.value = Number(volumeSlider.value) / 100;
    masterGain.connect(audioContext.destination);
  }

  function scheduleVisual(when, beat, isAccent) {
    const delay = Math.max(0, (when - audioContext.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      visualTimers.delete(timer);
      $('#beatDisplay').textContent = String((beat % beatsPerBar) + 1);
      beatOrb.classList.add('beat-hit');
      window.setTimeout(() => beatOrb.classList.remove('beat-hit'), 100);
      if (isAccent) beatOrb.style.borderColor = 'rgba(200,241,105,.58)';
      else beatOrb.style.borderColor = 'rgba(200,241,105,.32)';
    }, delay);
    visualTimers.add(timer);
  }

  function makeClick(when, beat, isSubdivision) {
    const accent = accentEnabled && beat % beatsPerBar === 0 && !isSubdivision;
    const volume = accent ? 0.78 : isSubdivision ? 0.34 : 0.54;
    const destination = panner || masterGain;
    const gain = audioContext.createGain();
    gain.connect(destination);
    const softSound = sound.startsWith('soft-');
    if (sound === 'soft-bell') {
      gain.gain.setValueAtTime(0.001, when);
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, when + 0.095);
    } else {
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.001, when + (softSound ? 0.11 : 0.075));
    }

    const osc = audioContext.createOscillator();
    const isSoftBell = sound === 'soft-bell';
    const isStudio = sound === 'studio';
    osc.type = softSound ? 'sine' : 'square';
    const frequency = softSound ? (isSoftBell ? 680 : (accent ? 1050 : 760)) : (isStudio ? (accent ? 1850 : 1250) : (accent ? 1550 : 1120));
    osc.frequency.setValueAtTime(frequency, when);
    osc.connect(gain);
    osc.start(when);
    osc.stop(when + (isSoftBell ? 0.1 : softSound ? 0.12 : isStudio ? 0.035 : 0.055));
  }

  function scheduler() {
    while (nextNoteTime < audioContext.currentTime + scheduleAheadSeconds) {
      if (pendingTempo !== null) {
        activeTempo = pendingTempo;
        pendingTempo = null;
      }
      const subdivisionsPerBeat = subdivision;
      for (let part = 0; part < subdivisionsPerBeat; part++) {
        const when = nextNoteTime + (part * 60) / (activeTempo * subdivisionsPerBeat);
        makeClick(when, beatNumber, part !== 0);
        scheduleVisual(when, beatNumber, accentEnabled && part === 0 && beatNumber % beatsPerBar === 0);
      }
      nextNoteTime += 60 / activeTempo;
      beatNumber++;
    }
  }

  function start() {
    ensureAudio();
    if (!audioContext || isPlaying) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    isPlaying = true;
    beatNumber = 0;
    activeTempo = bpm();
    pendingTempo = null;
    nextNoteTime = audioContext.currentTime + 0.06;
    scheduler();
    timerId = window.setInterval(scheduler, lookaheadMs);
    playLabel.textContent = 'Pausar';
    playButton.setAttribute('aria-label', 'Pausar metrónomo');
    playIcon.classList.add('is-playing');
    playIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 6v12M16 6v12"/></svg>';
    visualizer.classList.add('is-playing');
    statusText.textContent = 'MANTENIENDO EL PULSO';
    statusDot.classList.add('active');
  }

  function stop() {
    isPlaying = false;
    window.clearInterval(timerId);
    visualTimers.forEach(window.clearTimeout);
    visualTimers.clear();
    visualizer.classList.remove('is-playing');
    beatOrb.classList.remove('beat-hit');
    $('#beatDisplay').textContent = '—';
    playLabel.textContent = 'Empezar';
    playButton.setAttribute('aria-label', 'Iniciar metrónomo');
    playIcon.classList.remove('is-playing');
    playIcon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.8c0-.77.84-1.25 1.5-.86l9.15 5.34a1 1 0 0 1 0 1.72L9.5 17.34c-.66.39-1.5-.09-1.5-.86V5.8Z"/></svg>';
    statusText.textContent = 'LISTO PARA TOCAR';
    statusDot.classList.remove('active');
  }

  function tapTempo() {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2200) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length > 6) tapTimes.shift();
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      setTempo(60000 / average);
      $('#tapNote').textContent = `${tapTimes.length} toques · ${bpm()} BPM`;
    } else {
      $('#tapNote').textContent = 'Un toque más…';
    }
  }

  tempoSlider.addEventListener('input', () => setTempo(tempoSlider.value));
  tempoInput.addEventListener('change', () => setTempo(tempoInput.value));
  tempoInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') tempoInput.blur(); });
  $('#tempoDown').addEventListener('click', () => setTempo(bpm() - 1));
  $('#tempoUp').addEventListener('click', () => setTempo(bpm() + 1));
  playButton.addEventListener('click', () => isPlaying ? stop() : start());
  $('#tapButton').addEventListener('click', tapTempo);

  $('#accentToggle').addEventListener('change', (event) => {
    accentEnabled = event.currentTarget.checked;
    saveSettings();
  });

  document.querySelectorAll('[data-subdivision]').forEach((button) => button.addEventListener('click', () => {
    subdivision = Number(button.dataset.subdivision);
    document.querySelectorAll('[data-subdivision]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    $('#subdivisionValue').textContent = subdivision === 1 ? 'NEGRAS' : subdivision === 2 ? 'CORCHEAS' : 'SEMICORCHEAS';
  }));

  document.querySelectorAll('[data-sound]').forEach((button) => button.addEventListener('click', () => {
    sound = button.dataset.sound;
    document.querySelectorAll('[data-sound]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  }));

  volumeSlider.addEventListener('input', () => {
    const value = Number(volumeSlider.value);
    updateRange(volumeSlider);
    $('#volumeValue').textContent = `${value}%`;
    if (value > 0) previousVolume = value;
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(value / 100, audioContext.currentTime, 0.015);
    $('#muteButton').classList.toggle('muted', value === 0);
    $('#muteButton').setAttribute('aria-label', value === 0 ? 'Activar sonido' : 'Silenciar');
    saveSettings();
  });
  $('#muteButton').addEventListener('click', () => {
    volumeSlider.value = Number(volumeSlider.value) === 0 ? previousVolume : 0;
    volumeSlider.dispatchEvent(new Event('input'));
  });

  panSlider.addEventListener('input', () => {
    const value = Number(panSlider.value);
    updateRange(panSlider);
    $('#panValue').textContent = value === 0 ? 'CENTRO' : `${Math.abs(value)}% ${value < 0 ? 'IZQUIERDA' : 'DERECHA'}`;
    if (panner && audioContext) panner.pan.setTargetAtTime(value / 100, audioContext.currentTime, 0.02);
    saveSettings();
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
    if (typing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') { event.preventDefault(); isPlaying ? stop() : start(); }
    if (event.key.toLowerCase() === 't') tapTempo();
  });

  const savedSettings = readSettings();
  volumeSlider.value = savedSettings.volume;
  panSlider.value = savedSettings.pan;
  accentEnabled = savedSettings.accentEnabled;
  $('#accentToggle').checked = accentEnabled;
  previousVolume = savedSettings.volume > 0 ? savedSettings.volume : 75;
  [tempoSlider, volumeSlider, panSlider].forEach(updateRange);
  volumeSlider.dispatchEvent(new Event('input'));
  panSlider.dispatchEvent(new Event('input'));
})();

