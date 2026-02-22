// ═══════════════════════════════════════════════════════════
// 🎵 EPIC RPG - AUDIO ENGINE (Web Audio API, 8-bit Retro)
// ═══════════════════════════════════════════════════════════

const AudioEngine = (() => {
    let ctx = null;
    let masterGain = null;
    let bgmGain = null;
    let sfxGain = null;
    let bgmPlaying = false;
    let bgmOscillators = [];
    let bgmTimeout = null;
    let muted = false;
    let volume = 0.3; // default 30%
    let bgmAudio = null; // HTML5 Audio element for real music
    let currentBgmTrack = 'adventure'; // default track

    // ─── INIT ───
    function init() {
        if (ctx) return;
        ctx = new (window.AudioContext || window.webkitAudioContext)();

        masterGain = ctx.createGain();
        masterGain.gain.value = volume;
        masterGain.connect(ctx.destination);

        bgmGain = ctx.createGain();
        bgmGain.gain.value = 0.4; // BGM quieter than SFX
        bgmGain.connect(masterGain);

        sfxGain = ctx.createGain();
        sfxGain.gain.value = 1.0;
        sfxGain.connect(masterGain);
    }

    function ensureCtx() {
        if (!ctx) init();
        if (ctx.state === 'suspended') ctx.resume();
    }

    // ─── VOLUME & MUTE ───
    function setVolume(v) {
        volume = Math.max(0, Math.min(1, v));
        if (masterGain) masterGain.gain.value = muted ? 0 : volume;
        if (bgmAudio) bgmAudio.volume = (muted ? 0 : volume) * 0.4;
    }

    function getVolume() { return volume; }

    function toggleMute() {
        muted = !muted;
        if (masterGain) masterGain.gain.value = muted ? 0 : volume;
        if (bgmAudio) bgmAudio.volume = muted ? 0 : volume * 0.4;
        return muted;
    }

    function isMuted() { return muted; }

    // ─── UTILITY: play a note ───
    function playNote(freq, startTime, duration, type = 'square', gainNode = sfxGain, vol = 0.3) {
        ensureCtx();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        g.gain.setValueAtTime(vol, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(g);
        g.connect(gainNode);
        osc.start(startTime);
        osc.stop(startTime + duration);
        return osc;
    }

    // ─── UTILITY: noise burst (for hits) ───
    function playNoise(startTime, duration, gainNode = sfxGain, vol = 0.15) {
        ensureCtx();
        const bufferSize = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        noise.connect(g);
        g.connect(gainNode);
        noise.start(startTime);
        noise.stop(startTime + duration);
    }

    // ═══════════════════════════════════════
    // 🎵 BACKGROUND MUSIC (Real MP3 tracks)
    // ═══════════════════════════════════════
    var bgmTracks = {
        adventure: '/music/bgm-adventure.mp3',
        battle: '/music/bgm-boss.mp3',
        dungeon: '/music/bgm-dungeon.mp3',
        town: '/music/bgm-town.mp3'
    };

    function startBGM(trackName) {
        if (trackName) currentBgmTrack = trackName;
        var src = bgmTracks[currentBgmTrack] || bgmTracks.adventure;
        
        if (bgmAudio) {
            bgmAudio.pause();
            bgmAudio = null;
        }
        
        bgmAudio = new Audio(src);
        bgmAudio.loop = true;
        bgmAudio.volume = (muted ? 0 : volume) * 0.4; // BGM quieter than SFX
        bgmAudio.play().catch(function() { /* autoplay blocked, user needs to interact first */ });
        bgmPlaying = true;
    }

    function stopBGM() {
        bgmPlaying = false;
        if (bgmAudio) {
            bgmAudio.pause();
            bgmAudio.currentTime = 0;
        }
        // Also stop any old oscillator BGM
        bgmOscillators.forEach(function(o) { try { o.stop(); } catch(e){} });
        bgmOscillators = [];
        if (bgmTimeout) { clearTimeout(bgmTimeout); bgmTimeout = null; }
    }

    function switchBGM(trackName) {
        if (currentBgmTrack === trackName && bgmPlaying) return;
        currentBgmTrack = trackName;
        if (bgmPlaying) {
            // Fade out old, start new
            if (bgmAudio) {
                var oldAudio = bgmAudio;
                var fadeInterval = setInterval(function() {
                    if (oldAudio.volume > 0.02) {
                        oldAudio.volume = Math.max(0, oldAudio.volume - 0.02);
                    } else {
                        clearInterval(fadeInterval);
                        oldAudio.pause();
                    }
                }, 50);
            }
            setTimeout(function() { startBGM(trackName); }, 600);
        }
    }

    function playBGMLoop() {
        if (!bgmPlaying) return;
        ensureCtx();

        // Simple 8-bit RPG melody (C major pentatonic adventure theme)
        // Notes: C4=261.63, D4=293.66, E4=329.63, G4=392, A4=440, C5=523.25
        const melody = [
            // Bar 1: Adventure start
            { f: 261.63, d: 0.2 },  // C4
            { f: 329.63, d: 0.2 },  // E4
            { f: 392.00, d: 0.2 },  // G4
            { f: 523.25, d: 0.4 },  // C5 (hold)
            { f: 0,      d: 0.1 },  // rest
            { f: 440.00, d: 0.2 },  // A4
            { f: 392.00, d: 0.3 },  // G4

            // Bar 2: Descending
            { f: 392.00, d: 0.2 },  // G4
            { f: 329.63, d: 0.2 },  // E4
            { f: 293.66, d: 0.2 },  // D4
            { f: 261.63, d: 0.4 },  // C4 (hold)
            { f: 0,      d: 0.1 },  // rest
            { f: 293.66, d: 0.2 },  // D4
            { f: 329.63, d: 0.3 },  // E4

            // Bar 3: Rising tension
            { f: 329.63, d: 0.15 }, // E4
            { f: 392.00, d: 0.15 }, // G4
            { f: 440.00, d: 0.15 }, // A4
            { f: 523.25, d: 0.15 }, // C5
            { f: 587.33, d: 0.4 },  // D5
            { f: 523.25, d: 0.2 },  // C5
            { f: 440.00, d: 0.3 },  // A4
            { f: 0,      d: 0.1 },  // rest

            // Bar 4: Resolution
            { f: 392.00, d: 0.2 },  // G4
            { f: 329.63, d: 0.2 },  // E4
            { f: 293.66, d: 0.3 },  // D4
            { f: 261.63, d: 0.6 },  // C4 (long hold)
            { f: 0,      d: 0.3 },  // rest
        ];

        // Bass line (simpler, root notes)
        const bass = [
            { f: 130.81, d: 0.8 },  // C3
            { f: 0,      d: 0.1 },
            { f: 130.81, d: 0.7 },
            { f: 0,      d: 0.1 },

            { f: 110.00, d: 0.8 },  // A2
            { f: 0,      d: 0.1 },
            { f: 130.81, d: 0.7 },  // C3
            { f: 0,      d: 0.1 },

            { f: 146.83, d: 0.6 },  // D3
            { f: 130.81, d: 0.6 },  // C3
            { f: 110.00, d: 0.4 },  // A2
            { f: 0,      d: 0.1 },

            { f: 130.81, d: 0.6 },  // C3
            { f: 98.00,  d: 0.6 },  // G2
            { f: 130.81, d: 0.5 },  // C3
            { f: 0,      d: 0.3 },
        ];

        let t = ctx.currentTime + 0.05;

        // Play melody
        let melodyEnd = t;
        for (const note of melody) {
            if (note.f > 0) {
                const o = playNote(note.f, t, note.d, 'square', bgmGain, 0.12);
                bgmOscillators.push(o);
            }
            t += note.d;
            melodyEnd = t;
        }

        // Play bass
        let bt = ctx.currentTime + 0.05;
        for (const note of bass) {
            if (note.f > 0) {
                const o = playNote(note.f, bt, note.d, 'triangle', bgmGain, 0.15);
                bgmOscillators.push(o);
            }
            bt += note.d;
        }

        // Play simple percussion (kick drum style noise hits on beats)
        var percT = ctx.currentTime + 0.05;
        var beatDuration = 0.4;
        var totalBeats = Math.floor((melodyEnd - percT) / beatDuration);
        for (var b = 0; b < totalBeats; b++) {
            var hitTime = percT + (b * beatDuration);
            // Kick on every beat
            if (b % 2 === 0) {
                playNoise(hitTime, 0.06, bgmGain, 0.04);
                // Low thump
                var kick = ctx.createOscillator();
                var kickG = ctx.createGain();
                kick.type = 'sine';
                kick.frequency.setValueAtTime(150, hitTime);
                kick.frequency.exponentialRampToValueAtTime(40, hitTime + 0.1);
                kickG.gain.setValueAtTime(0.08, hitTime);
                kickG.gain.exponentialRampToValueAtTime(0.001, hitTime + 0.12);
                kick.connect(kickG);
                kickG.connect(bgmGain);
                kick.start(hitTime);
                kick.stop(hitTime + 0.15);
                bgmOscillators.push(kick);
            }
            // Hi-hat on off-beats
            if (b % 2 === 1) {
                playNoise(hitTime, 0.03, bgmGain, 0.02);
            }
        }

        // Harmony layer (soft pad chords, very quiet)
        var harmonyChords = [
            { f: 329.63, d: 1.6 }, // E4
            { f: 440.00, d: 1.6 }, // A4
            { f: 293.66, d: 1.6 }, // D4
            { f: 261.63, d: 1.6 }, // C4
        ];
        var ht = ctx.currentTime + 0.05;
        for (var hi = 0; hi < harmonyChords.length; hi++) {
            var hNote = harmonyChords[hi];
            var hOsc = ctx.createOscillator();
            var hGain = ctx.createGain();
            hOsc.type = 'sine';
            hOsc.frequency.setValueAtTime(hNote.f, ht);
            hGain.gain.setValueAtTime(0.03, ht);
            hGain.gain.setValueAtTime(0.04, ht + 0.1);
            hGain.gain.exponentialRampToValueAtTime(0.001, ht + hNote.d);
            hOsc.connect(hGain);
            hGain.connect(bgmGain);
            hOsc.start(ht);
            hOsc.stop(ht + hNote.d + 0.01);
            bgmOscillators.push(hOsc);
            ht += hNote.d;
        }

        // Total loop duration
        const totalDuration = melodyEnd - (ctx.currentTime + 0.05);
        bgmTimeout = setTimeout(() => {
            bgmOscillators = [];
            if (bgmPlaying) playBGMLoop();
        }, totalDuration * 1000);
    }

    // ═══════════════════════════════════════
    // 🔊 SOUND EFFECTS
    // ═══════════════════════════════════════

    // ─── Attack/Hit (short aggressive beep + noise) ───
    function sfxAttack() {
        ensureCtx();
        const t = ctx.currentTime;
        playNote(220, t, 0.08, 'square', sfxGain, 0.25);
        playNote(180, t + 0.04, 0.06, 'sawtooth', sfxGain, 0.15);
        playNoise(t, 0.06, sfxGain, 0.1);
    }

    // ─── Level Up (ascending tones, triumphant) ───
    function sfxLevelUp() {
        ensureCtx();
        const t = ctx.currentTime;
        const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99];
        notes.forEach((f, i) => {
            playNote(f, t + i * 0.1, 0.15, 'square', sfxGain, 0.2);
        });
        // Final chord
        playNote(523.25, t + 0.6, 0.5, 'square', sfxGain, 0.15);
        playNote(659.25, t + 0.6, 0.5, 'triangle', sfxGain, 0.15);
        playNote(783.99, t + 0.6, 0.5, 'square', sfxGain, 0.12);
    }

    // ─── Gold Collect (coin ding) ───
    function sfxGold() {
        ensureCtx();
        const t = ctx.currentTime;
        playNote(1318.5, t, 0.08, 'square', sfxGain, 0.15);
        playNote(1568, t + 0.08, 0.15, 'square', sfxGain, 0.12);
    }

    // ─── Monster Death (descending crash) ───
    function sfxMonsterDeath() {
        ensureCtx();
        const t = ctx.currentTime;
        playNote(400, t, 0.1, 'sawtooth', sfxGain, 0.2);
        playNote(300, t + 0.08, 0.1, 'sawtooth', sfxGain, 0.18);
        playNote(200, t + 0.16, 0.1, 'sawtooth', sfxGain, 0.15);
        playNote(100, t + 0.24, 0.2, 'sawtooth', sfxGain, 0.12);
        playNoise(t + 0.1, 0.2, sfxGain, 0.12);
    }

    // ─── Player Death/Defeat (sad descending) ───
    function sfxPlayerDeath() {
        ensureCtx();
        const t = ctx.currentTime;
        playNote(440, t, 0.3, 'triangle', sfxGain, 0.2);
        playNote(392, t + 0.3, 0.3, 'triangle', sfxGain, 0.18);
        playNote(329.63, t + 0.6, 0.3, 'triangle', sfxGain, 0.16);
        playNote(261.63, t + 0.9, 0.5, 'triangle', sfxGain, 0.14);
        playNote(246.94, t + 1.2, 0.6, 'triangle', sfxGain, 0.12);
    }

    // ─── Button Click (subtle tick) ───
    function sfxClick() {
        ensureCtx();
        const t = ctx.currentTime;
        playNote(800, t, 0.04, 'square', sfxGain, 0.08);
        playNote(1000, t + 0.02, 0.03, 'square', sfxGain, 0.06);
    }

    // ─── Shop Buy/Sell (register cha-ching) ───
    function sfxShop() {
        ensureCtx();
        const t = ctx.currentTime;
        playNote(1200, t, 0.06, 'square', sfxGain, 0.12);
        playNote(1500, t + 0.06, 0.06, 'square', sfxGain, 0.12);
        playNote(2000, t + 0.12, 0.1, 'square', sfxGain, 0.1);
        playNote(1500, t + 0.22, 0.06, 'square', sfxGain, 0.08);
        playNote(2000, t + 0.28, 0.15, 'square', sfxGain, 0.1);
    }

    // ─── Craft Success (anvil hammer + sparkle) ───
    function sfxCraft() {
        ensureCtx();
        const t = ctx.currentTime;
        // Hammer hits
        playNoise(t, 0.05, sfxGain, 0.2);
        playNote(200, t, 0.05, 'square', sfxGain, 0.15);
        playNoise(t + 0.12, 0.05, sfxGain, 0.18);
        playNote(250, t + 0.12, 0.05, 'square', sfxGain, 0.15);
        // Sparkle result
        playNote(880, t + 0.25, 0.08, 'square', sfxGain, 0.12);
        playNote(1108.7, t + 0.33, 0.08, 'square', sfxGain, 0.12);
        playNote(1318.5, t + 0.41, 0.15, 'square', sfxGain, 0.1);
    }

    // ─── PvP Duel Start (dramatic war horn) ───
    function sfxDuelStart() {
        ensureCtx();
        const t = ctx.currentTime;
        // Horn blast
        playNote(196, t, 0.3, 'sawtooth', sfxGain, 0.15);
        playNote(261.63, t + 0.3, 0.3, 'sawtooth', sfxGain, 0.18);
        playNote(329.63, t + 0.6, 0.5, 'sawtooth', sfxGain, 0.2);
        // Dramatic drums
        playNoise(t + 0.15, 0.05, sfxGain, 0.15);
        playNoise(t + 0.45, 0.05, sfxGain, 0.15);
        playNoise(t + 0.75, 0.08, sfxGain, 0.18);
    }

    // ─── Victory Fanfare (triumphant melody) ───
    function sfxVictory() {
        ensureCtx();
        const t = ctx.currentTime;
        // Classic RPG victory jingle
        const notes = [
            { f: 523.25, d: 0.15 }, // C5
            { f: 523.25, d: 0.15 }, // C5
            { f: 523.25, d: 0.15 }, // C5
            { f: 523.25, d: 0.4 },  // C5 (hold)
            { f: 415.30, d: 0.15 }, // Ab4
            { f: 466.16, d: 0.15 }, // Bb4
            { f: 523.25, d: 0.15 }, // C5
            { f: 0,      d: 0.08 }, // tiny rest
            { f: 466.16, d: 0.15 }, // Bb4
            { f: 523.25, d: 0.5 },  // C5 (long hold)
        ];
        let nt = t;
        notes.forEach(n => {
            if (n.f > 0) {
                playNote(n.f, nt, n.d, 'square', sfxGain, 0.18);
            }
            nt += n.d;
        });
        // Bass chord underneath
        playNote(130.81, t, 1.0, 'triangle', sfxGain, 0.12);
        playNote(196.00, t, 1.0, 'triangle', sfxGain, 0.1);
    }

    // ─── Heal/Potion (gentle sparkle ascending) ───
    function sfxHeal() {
        ensureCtx();
        const t = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
            playNote(f, t + i * 0.08, 0.12, 'sine', sfxGain, 0.15);
            playNote(f * 1.5, t + i * 0.08 + 0.04, 0.08, 'sine', sfxGain, 0.08);
        });
    }

    // Public API
    return {
        init,
        setVolume,
        getVolume,
        toggleMute,
        isMuted,
        startBGM,
        stopBGM,
        switchBGM,
        sfxAttack,
        sfxLevelUp,
        sfxGold,
        sfxMonsterDeath,
        sfxPlayerDeath,
        sfxClick,
        sfxShop,
        sfxCraft,
        sfxDuelStart,
        sfxVictory,
        sfxHeal,
    };
})();
