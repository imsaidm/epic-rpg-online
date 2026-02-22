// ─── Socket.io ───
const socket = io();

// ─── State ───
let currentChar = null;
let currentPanel = 'hunt';
let shopItems = [];
let onlinePlayers = [];
let myCharId = null;
let bgmStarted = false;
let huntCooldownTimer = null;
let restCooldownTimer = null;

// ─── Audio Control Functions ───
function toggleGameMute() {
    ensureAudioInit();
    const muted = AudioEngine.toggleMute();
    const btn = $('btn-mute');
    btn.textContent = muted ? '🔇' : '🔊';
    btn.classList.toggle('muted', muted);
}

function setGameVolume(val) {
    ensureAudioInit();
    AudioEngine.setVolume(val / 100);
    const btn = $('btn-mute');
    if (val == 0) {
        btn.textContent = '🔇';
    } else if (val < 50) {
        btn.textContent = '🔉';
    } else {
        btn.textContent = '🔊';
    }
}

function toggleBGM() {
    ensureAudioInit();
    const btn = $('btn-bgm');
    if (bgmStarted) {
        AudioEngine.stopBGM();
        bgmStarted = false;
        btn.classList.remove('active');
        btn.textContent = '🎵';
    } else {
        AudioEngine.startBGM();
        bgmStarted = true;
        btn.classList.add('active');
        btn.textContent = '🎶';
    }
}

function ensureAudioInit() {
    AudioEngine.init();
}

// Auto-init audio on first user interaction
document.addEventListener('click', () => {
    AudioEngine.init();
}, { once: true });

// ─── Monster Emoji Map ───
const MONSTER_EMOJI = {
    'Slime': '🟢', 'Rat': '🐀', 'Goblin': '👺', 'Wolf': '🐺',
    'Bandit': '🗡️', 'Skeleton': '💀', 'Giant Spider': '🕷️', 'Orc': '👹',
    'Dark Mage': '🧙‍♂️', 'Troll': '🧌', 'Vampire': '🧛', 'Werewolf': '🐺',
    'Golem': '🗿', 'Demon': '😈', 'Shadow Knight': '🖤', 'Dragon': '🐉',
    'Ice Elemental': '❄️', 'Fire Elemental': '🔥',
    'Goblin King': '👑', 'Forest Guardian': '🌳', 'Lich Lord': '☠️',
    'Elder Dragon': '🐲', 'Shadow Emperor': '👿', 'Kraken Overlord': '🐙'
};

const CLASS_EMOJI = { 'Warrior': '⚔️', 'Mage': '🧙', 'Archer': '🏹' };

// ─── Helpers ───
function $(id) { return document.getElementById(id); }
function show(id) { $(id).style.display = 'flex'; }
function hide(id) { $(id).style.display = 'none'; }

function toast(msg, type = 'info') {
    const container = $('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

async function api(url, opts = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...opts,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        return await res.json();
    } catch (e) {
        toast('Network error!', 'error');
        return { error: 'Network error' };
    }
}

// ─── AUTH ───
function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    if (tab === 'login') {
        document.querySelectorAll('.auth-tab')[0].classList.add('active');
        $('login-form').style.display = 'block';
        $('register-form').style.display = 'none';
    } else {
        document.querySelectorAll('.auth-tab')[1].classList.add('active');
        $('login-form').style.display = 'none';
        $('register-form').style.display = 'block';
    }
    $('auth-error').textContent = '';
}

async function doLogin() {
    AudioEngine.sfxClick();
    const username = $('login-user').value.trim();
    const password = $('login-pass').value;
    if (!username || !password) { $('auth-error').textContent = 'Fill in all fields!'; return; }
    const data = await api('/api/login', { method: 'POST', body: { username, password } });
    if (data.error) { $('auth-error').textContent = data.error; return; }
    toast('Login successful!', 'success');
    checkSession();
}

async function doRegister() {
    AudioEngine.sfxClick();
    const username = $('reg-user').value.trim();
    const password = $('reg-pass').value;
    if (!username || !password) { $('auth-error').textContent = 'Fill in all fields!'; return; }
    const data = await api('/api/register', { method: 'POST', body: { username, password } });
    if (data.error) { $('auth-error').textContent = data.error; return; }
    toast('Account created!', 'success');
    checkSession();
}

async function doLogout() {
    await api('/api/logout', { method: 'POST' });
    location.reload();
}

// ─── CHARACTER CREATION ───
let selectedClass = null;

function selectClass(cls) {
    AudioEngine.sfxClick();
    selectedClass = cls;
    document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
    document.querySelector(`.class-card[data-class="${cls}"]`).classList.add('selected');
}

async function createCharacter() {
    const name = $('char-name').value.trim();
    if (!name) { $('create-error').textContent = 'Enter a character name!'; return; }
    if (!selectedClass) { $('create-error').textContent = 'Select a class!'; return; }
    const data = await api('/api/character/create', { method: 'POST', body: { name, charClass: selectedClass } });
    if (data.error) { $('create-error').textContent = data.error; return; }
    AudioEngine.sfxVictory();
    toast('Character created! Welcome, ' + name + '!', 'success');
    currentChar = data.character;
    enterGame();
}

// ─── SESSION CHECK ───
async function checkSession() {
    const data = await api('/api/me');
    if (!data.loggedIn) {
        show('auth-screen');
        hide('create-screen');
        hide('game-screen');
        return;
    }
    hide('auth-screen');
    if (!data.character) {
        show('create-screen');
        hide('game-screen');
    } else {
        currentChar = data.character;
        enterGame();
    }
}

// ─── ENTER GAME ───
async function enterGame() {
    hide('auth-screen');
    hide('create-screen');
    $('game-screen').style.display = 'flex';

    // Fetch full char with bonuses
    const charData = await api('/api/character');
    if (!charData.error) {
        currentChar = charData;
        myCharId = charData.id;
    }

    updateCharDisplay();
    loadShop();
    loadDungeons();
    loadRecipes();
    loadQuests();
    checkTutorial();

    // Auto-start BGM when entering game
    if (!bgmStarted) {
        try {
            ensureAudioInit();
            AudioEngine.startBGM();
            bgmStarted = true;
            const bgmBtn = $('btn-bgm');
            if (bgmBtn) {
                bgmBtn.classList.add('active');
                bgmBtn.textContent = '🎶';
            }
        } catch(e) { /* user hasn't interacted yet, BGM will start on first click */ }
    }

    // Socket reconnect with session
    socket.emit('chat-history');
}

// ─── UPDATE CHARACTER DISPLAY ───
function updateCharDisplay() {
    if (!currentChar) return;
    const c = currentChar;
    $('nav-player-name').textContent = c.name;
    $('portrait-icon').textContent = CLASS_EMOJI[c.class] || '⚔️';
    $('char-name-display').textContent = c.name;
    $('char-class-display').textContent = c.class;
    $('char-level-display').textContent = `Level ${c.level}`;

    const maxHp = c.total_max_hp || c.max_hp;
    $('hp-text').textContent = `${c.hp}/${maxHp}`;
    $('hp-bar').style.width = `${Math.max(0, (c.hp / maxHp) * 100)}%`;

    const xpNeeded = c.xp_needed || 50;
    $('xp-text').textContent = `${c.xp}/${xpNeeded}`;
    $('xp-bar').style.width = `${Math.min(100, (c.xp / xpNeeded) * 100)}%`;

    // FIX #2: Show buff bonuses in ATK/DEF display
    const buffAtkStr = c.buff_atk ? ` 🔥+${c.buff_atk}` : '';
    const buffDefStr = c.buff_def ? ` 🔥+${c.buff_def}` : '';
    const atkText = c.bonus_atk || c.buff_atk ? `${c.total_atk} (+${c.bonus_atk || 0}${buffAtkStr})` : `${c.atk}`;
    const defText = c.bonus_def || c.buff_def ? `${c.total_def} (+${c.bonus_def || 0}${buffDefStr})` : `${c.def}`;
    $('stat-atk').innerHTML = atkText;
    $('stat-def').innerHTML = defText;
    $('stat-gold').textContent = c.gold;

    // FIX #2: Show active buffs below stats
    const buffsEl = $('active-buffs-display');
    if (buffsEl) {
        if (c.active_buffs && c.active_buffs.length > 0) {
            buffsEl.innerHTML = c.active_buffs.map(function(b) {
                const remaining = Math.max(0, Math.ceil((new Date(b.expires_at) - Date.now()) / 1000));
                const mins = Math.floor(remaining / 60);
                const secs = remaining % 60;
                const icon = b.buff_type === 'atk' ? '⚔️' : '🛡️';
                return '<div class="buff-entry">' + icon + ' +' + b.value + ' ' + b.buff_type.toUpperCase() + ' (' + mins + 'm' + secs + 's)</div>';
            }).join('');
            buffsEl.style.display = 'block';
        } else {
            buffsEl.innerHTML = '';
            buffsEl.style.display = 'none';
        }
    }
}

// ─── PANEL SWITCHING ───
function switchPanel(panel) {
    AudioEngine.sfxClick();
    currentPanel = panel;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-tab[data-panel="${panel}"]`).classList.add('active');
    document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
    $(`panel-${panel}`).classList.add('active');

    if (panel === 'inventory') loadInventory();
    if (panel === 'shop') loadShop();
    if (panel === 'craft') loadRecipes();
    if (panel === 'pvp') updatePvPList();
    if (panel === 'adventure') loadDungeons();
    if (panel === 'stats') loadStats();
    if (panel === 'quests') loadQuests();
}

// ─── BATTLE ANIMATION HELPERS ───
function triggerAnim(elementId, animClass, duration) {
    var el = typeof elementId === 'string' ? $(elementId) : elementId;
    if (!el) return;
    el.classList.remove(animClass);
    // Force reflow so re-adding the class triggers animation again
    void el.offsetWidth;
    el.classList.add(animClass);
    setTimeout(function() { el.classList.remove(animClass); }, duration || 500);
}

function updateHpBarColor(fillEl, ratio) {
    fillEl.classList.remove('hp-high', 'hp-mid', 'hp-low');
    if (ratio > 0.5) {
        fillEl.classList.add('hp-high');
    } else if (ratio > 0.25) {
        fillEl.classList.add('hp-mid');
    } else {
        fillEl.classList.add('hp-low');
    }
}

function setHpBarWithText(fillEl, current, max) {
    var ratio = Math.max(0, current / max);
    fillEl.style.width = (ratio * 100) + '%';
    updateHpBarColor(fillEl, ratio);
    // Update or create HP text overlay
    var barContainer = fillEl.parentElement;
    var textOverlay = barContainer.querySelector('.hp-text-overlay');
    if (!textOverlay) {
        textOverlay = document.createElement('span');
        textOverlay.className = 'hp-text-overlay';
        barContainer.appendChild(textOverlay);
    }
    textOverlay.textContent = Math.max(0, current) + '/' + max;
}

function showFloatingDmg(entityEl, amount, type) {
    var floater = document.createElement('div');
    floater.className = 'floating-dmg ' + (type || 'damage');
    floater.textContent = (type === 'heal' ? '+' : '-') + amount;
    // Random horizontal offset
    var offsetX = Math.floor(Math.random() * 40) - 20;
    floater.style.left = 'calc(50% + ' + offsetX + 'px)';
    floater.style.top = '0px';
    entityEl.appendChild(floater);
    setTimeout(function() { if (floater.parentNode) floater.remove(); }, 1100);
}

function formatLogMsg(msg) {
    // Highlight damage numbers (e.g. "deals 15 damage", "hits for 12")
    var formatted = msg.replace(/(\d+)\s*(damage|dmg|hit)/gi, '<span class="dmg-number">$1</span> $2');
    // Highlight heal numbers
    formatted = formatted.replace(/(heal|restore|recover)\w*\s*(\d+)/gi, '$1 <span class="heal-number">$2</span>');
    // Also highlight standalone numbers after "for" (e.g. "attacks for 15")
    formatted = formatted.replace(/for\s+(\d+)/gi, 'for <span class="dmg-number">$1</span>');
    return formatted;
}

function showMonsterIntro(monsterName, monsterEmoji, monsterLevel) {
    return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.className = 'monster-intro-overlay';
        overlay.innerHTML = '<div class="intro-emoji">' + monsterEmoji + '</div>' +
            '<div class="intro-text">A wild ' + monsterName + ' appeared!</div>' +
            '<div class="intro-level">Level ' + monsterLevel + '</div>';
        document.body.appendChild(overlay);
        setTimeout(function() {
            overlay.style.transition = 'opacity 0.3s ease';
            overlay.style.opacity = '0';
            setTimeout(function() {
                if (overlay.parentNode) overlay.remove();
                resolve();
            }, 300);
        }, 1200);
    });
}

function showVictoryConfetti(resultEl) {
    resultEl.classList.add('confetti');
    // Spawn extra confetti particles
    var colors = ['#ff4444', '#44ff44', '#4488ff', '#ffaa00', '#aa44ff', '#ffd700', '#ff6644'];
    for (var i = 0; i < 20; i++) {
        (function(idx) {
            setTimeout(function() {
                var particle = document.createElement('div');
                particle.className = 'confetti-particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 30 + '%';
                particle.style.backgroundColor = colors[idx % colors.length];
                particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
                particle.style.animationDelay = (Math.random() * 0.5) + 's';
                particle.style.animationDuration = (1 + Math.random()) + 's';
                resultEl.appendChild(particle);
                setTimeout(function() { if (particle.parentNode) particle.remove(); }, 2500);
            }, idx * 80);
        })(i);
    }
}

function showDefeatDarken() {
    var overlay = document.createElement('div');
    overlay.className = 'defeat-overlay-darken';
    document.body.appendChild(overlay);
    setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 1600);
}

// ─── HUNT (IMPROVED) ───
async function doHunt() {
    const btn = $('hunt-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Hunting...';

    // Switch to battle music
    if (bgmStarted) AudioEngine.switchBGM('battle');

    const data = await api('/api/hunt', { method: 'POST' });
    if (data.error) {
        toast(data.error, 'error');
        btn.disabled = false;
        btn.textContent = '🗡️ GO HUNTING!';
        return;
    }

    const monsterEmoji = MONSTER_EMOJI[data.monster.name] || '👹';
    const monsterLevel = data.monster.level || '?';

    // Monster encounter intro
    await showMonsterIntro(data.monster.name, monsterEmoji, monsterLevel);

    // Show battle display
    const bd = $('battle-display');
    bd.style.display = 'block';
    $('monster-battle-icon').textContent = monsterEmoji;
    $('monster-battle-name').textContent = data.monster.name + ' Lv.' + monsterLevel;
    $('player-battle-name').textContent = currentChar.name;
    $('player-battle-icon').textContent = CLASS_EMOJI[currentChar.class] || '⚔️';

    // Reset HP bars with text
    const playerMaxHp = currentChar.total_max_hp || currentChar.max_hp;
    const playerFill = $('player-hp-fill');
    const monsterFill = $('monster-hp-fill');

    // Calculate monster max HP from first log entry
    var monsterMaxHp = 100;
    if (data.log.length > 0 && data.log[0].monsterHp !== undefined) {
        var firstDmg = 0;
        var match = data.log[0].msg.match(/(\d+)/);
        if (match && data.log[0].actor === 'player') firstDmg = parseInt(match[0]);
        monsterMaxHp = data.log[0].monsterHp + firstDmg;
    }

    setHpBarWithText(playerFill, playerMaxHp, playerMaxHp);
    setHpBarWithText(monsterFill, monsterMaxHp, monsterMaxHp);

    // Animate battle log
    const logEl = $('battle-log');
    logEl.innerHTML = '';
    $('battle-result').style.display = 'none';
    $('battle-result').classList.remove('confetti');

    var prevPlayerHp = playerMaxHp;
    var prevMonsterHp = monsterMaxHp;

    for (let i = 0; i < data.log.length; i++) {
        await delay(450);
        const entry = data.log[i];
        const div = document.createElement('div');
        div.className = 'log-entry ' + (entry.actor === 'player' ? 'player-action' : 'monster-action');
        div.innerHTML = formatLogMsg(entry.msg);
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;

        // Play attack sound for each hit
        AudioEngine.sfxAttack();

        // Entity animations based on who is acting
        if (entry.actor === 'player') {
            // Player attacks: player lunges, monster gets hit
            triggerAnim('player-battle-icon', 'attack-anim-left', 400);
            setTimeout(function() {
                triggerAnim('monster-battle-icon', 'shake', 400);
                triggerAnim('monster-battle-icon', 'flash-red', 500);
            }, 150);
        } else {
            // Monster attacks: monster lunges, player gets hit
            triggerAnim('monster-battle-icon', 'attack-anim-right', 400);
            setTimeout(function() {
                triggerAnim('player-battle-icon', 'shake', 400);
                triggerAnim('player-battle-icon', 'flash-red', 500);
            }, 150);
        }

        // Update HP bars with color + text
        if (entry.playerHp !== undefined) {
            setHpBarWithText(playerFill, entry.playerHp, playerMaxHp);
            // Floating damage number on player
            if (entry.playerHp < prevPlayerHp) {
                var dmg = prevPlayerHp - entry.playerHp;
                var playerEntity = $('player-battle-icon').closest('.battle-entity');
                showFloatingDmg(playerEntity, dmg, 'damage');
                // Screen shake for big damage (>20% max HP)
                if (dmg > playerMaxHp * 0.2) {
                    triggerAnim('battle-display', 'screen-shake', 350);
                }
            }
            prevPlayerHp = entry.playerHp;
        }
        if (entry.monsterHp !== undefined) {
            setHpBarWithText(monsterFill, entry.monsterHp, monsterMaxHp);
            // Floating damage on monster
            if (entry.monsterHp < prevMonsterHp) {
                var mDmg = prevMonsterHp - entry.monsterHp;
                var monsterEntity = $('monster-battle-icon').closest('.battle-entity');
                showFloatingDmg(monsterEntity, mDmg, 'damage');
                // Screen shake for big damage (>20% monster max HP)
                if (mDmg > monsterMaxHp * 0.2) {
                    triggerAnim('battle-display', 'screen-shake', 350);
                }
            }
            prevMonsterHp = entry.monsterHp;
        }
    }

    // Show result
    await delay(500);
    const resultEl = $('battle-result');
    resultEl.style.display = 'block';
    resultEl.className = 'battle-result ' + (data.won ? 'victory' : 'defeat');

    // Play victory or defeat sound
    if (data.won) {
        AudioEngine.sfxMonsterDeath();
        setTimeout(function() { AudioEngine.sfxVictory(); }, 300);
        if (data.goldGained > 0) setTimeout(function() { AudioEngine.sfxGold(); }, 800);
    } else {
        AudioEngine.sfxPlayerDeath();
    }

    let resultHtml = data.won
        ? '<div>🎉 VICTORY!</div><div class="rewards">+' + data.xpGained + ' XP | +' + data.goldGained + ' Gold</div>'
        : '<div>💀 DEFEATED!</div><div style="font-size:8px;margin-top:6px;">You retreat and recover...</div>';

    if (data.droppedItems.length > 0) {
        resultHtml += '<div class="drops">📦 Loot: ' + data.droppedItems.map(function(i) { return i.name; }).join(', ') + '</div>';
    }

    if (data.levelUps.length > 0) {
        AudioEngine.sfxLevelUp();
        for (const lu of data.levelUps) {
            resultHtml += '<div class="level-up-msg">⭐ LEVEL UP! Now Level ' + lu.level + '! HP+' + lu.hpGain + ' ATK+' + lu.atkGain + ' DEF+' + lu.defGain + '</div>';
        }
    }

    resultEl.innerHTML = resultHtml;

    // Victory confetti or defeat darken
    if (data.won) {
        showVictoryConfetti(resultEl);
    } else {
        showDefeatDarken();
    }

    // Update character
    currentChar = data.character;
    updateCharDisplay();

    // Switch back to adventure music
    if (bgmStarted) AudioEngine.switchBGM('adventure');

    // Hunt cooldown (3 seconds)
    startHuntCooldown();

    // Refresh quests after hunt
    loadQuests();
}

function startHuntCooldown() {
    const btn = $('hunt-btn');
    let remaining = 3;
    btn.disabled = true;
    btn.textContent = `⏳ Wait ${remaining}s...`;
    huntCooldownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(huntCooldownTimer);
            huntCooldownTimer = null;
            btn.disabled = false;
            btn.textContent = '🗡️ GO HUNTING!';
        } else {
            btn.textContent = `⏳ Wait ${remaining}s...`;
        }
    }, 1000);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── SHOP ───
async function loadShop() {
    const data = await api('/api/shop');
    if (data.error) return;
    shopItems = data;
    renderShop('all');
}

function filterShop(type) {
    document.querySelectorAll('#shop-filters .filter-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    renderShop(type);
}

function renderShop(filter) {
    const grid = $('shop-grid');
    const items = filter === 'all' ? shopItems : shopItems.filter(i => i.type === filter);
    grid.innerHTML = items.map(item => `
        <div class="shop-item rarity-border-${item.rarity}">
            <div class="item-header">
                <span class="item-name rarity-${item.rarity}">${getItemEmoji(item.type)} ${item.name}</span>
                <span class="item-type">${item.type}</span>
            </div>
            <div class="item-desc">${item.description}</div>
            <div class="item-stats">
                ${item.atk_bonus ? `<span>⚔️ +${item.atk_bonus}</span>` : ''}
                ${item.def_bonus ? `<span>🛡️ +${item.def_bonus}</span>` : ''}
                ${item.hp_bonus ? `<span>❤️ +${item.hp_bonus}</span>` : ''}
            </div>
            <div class="item-footer">
                <span class="item-price">💰 ${item.price}G</span>
                <button class="btn btn-sm btn-success" onclick="buyItem(${item.id})">BUY</button>
            </div>
        </div>
    `).join('');
}

function getItemEmoji(type) {
    return { weapon: '⚔️', armor: '🛡️', potion: '🧪', material: '📦' }[type] || '📦';
}

async function buyItem(itemId) {
    const data = await api('/api/shop/buy', { method: 'POST', body: { itemId } });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxShop();
    toast(data.message, 'gold');
    // Refresh char data
    const charData = await api('/api/character');
    if (!charData.error) { currentChar = charData; updateCharDisplay(); }
}

// ─── INVENTORY ───
async function loadInventory() {
    const data = await api('/api/inventory');
    if (data.error) return;

    const grid = $('inv-grid');
    if (data.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-dim);font-size:9px;">Your inventory is empty. Go hunting!</p>';
        return;
    }

    grid.innerHTML = data.map(item => `
        <div class="inv-item rarity-border-${item.rarity}">
            <div class="item-header">
                <span class="item-name rarity-${item.rarity}">
                    ${getItemEmoji(item.type)} ${item.name} x${item.quantity}
                    ${item.equipped ? '<span class="equipped-badge">EQUIPPED</span>' : ''}
                </span>
            </div>
            <div class="item-desc">${item.description}</div>
            <div class="item-stats">
                ${item.atk_bonus ? `<span>⚔️ +${item.atk_bonus}</span>` : ''}
                ${item.def_bonus ? `<span>🛡️ +${item.def_bonus}</span>` : ''}
                ${item.hp_bonus ? `<span>❤️ +${item.hp_bonus}</span>` : ''}
                <span class="rarity-${item.rarity}">[${item.rarity}]</span>
            </div>
            <div class="item-actions">
                ${item.type === 'weapon' || item.type === 'armor' ?
                    `<button class="btn btn-sm btn-primary" onclick="equipItem(${item.inv_id})">${item.equipped ? 'UNEQUIP' : 'EQUIP'}</button>` : ''}
                ${item.type === 'potion' ?
                    `<button class="btn btn-sm btn-success" onclick="useItem(${item.inv_id})">USE</button>` : ''}
                <button class="btn btn-sm btn-danger" onclick="sellItem(${item.inv_id}, '${item.name.replace(/'/g, "\\'")}', ${Math.floor(item.price * 0.5)})">SELL (${Math.floor(item.price * 0.5)}G)</button>
            </div>
        </div>
    `).join('');
}

async function equipItem(invId) {
    const data = await api('/api/inventory/equip', { method: 'POST', body: { invId } });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxClick();
    toast('Equipment updated!', 'success');
    loadInventory();
    const charData = await api('/api/character');
    if (!charData.error) { currentChar = charData; updateCharDisplay(); }
}

async function useItem(invId) {
    const data = await api('/api/inventory/use', { method: 'POST', body: { invId } });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxHeal();
    // FIX #2: Show appropriate message for buff or heal potions
    toast(data.message || `Healed ${data.healed} HP!`, 'success');
    currentChar = data.character;
    updateCharDisplay();
    loadInventory();
}

async function sellItem(invId, itemName, sellPrice) {
    // FIX #5: Confirm before selling
    if (!confirm('Sell ' + (itemName || 'this item') + ' for ' + (sellPrice || '?') + ' gold?')) return;
    const data = await api('/api/shop/sell', { method: 'POST', body: { invId } });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxShop();
    toast(data.message, 'gold');
    loadInventory();
    const charData = await api('/api/character');
    if (!charData.error) { currentChar = charData; updateCharDisplay(); }
}

// ─── DUNGEONS ───
async function loadDungeons() {
    const data = await api('/api/dungeons');
    if (data.error) return;
    const grid = $('dungeon-grid');
    grid.innerHTML = data.map(d => {
        const locked = currentChar && currentChar.level < d.level_req;
        return `
        <div class="dungeon-card ${locked ? 'locked' : ''}">
            <div class="dungeon-name">🏰 ${d.name}</div>
            <div class="dungeon-req">📊 Required Level: ${d.level_req}</div>
            <div class="dungeon-boss">👹 Boss: ${d.boss_name} (HP:${d.boss_hp} ATK:${d.boss_atk})</div>
            <button class="btn btn-sm ${locked ? 'btn-danger' : 'btn-primary'}" 
                    onclick="enterDungeon(${d.id})" ${locked ? 'disabled' : ''}>
                ${locked ? '🔒 LOCKED' : '⚔️ ENTER'}
            </button>
        </div>`;
    }).join('');
}

async function enterDungeon(dungeonId) {
    // Disable all dungeon buttons to prevent spam
    document.querySelectorAll('.dungeon-card button').forEach(function(b) { b.disabled = true; });
    
    // Switch to dungeon music
    if (bgmStarted) AudioEngine.switchBGM('dungeon');
    
    const data = await api('/api/dungeon/enter', { method: 'POST', body: { dungeonId } });
    if (data.error) { 
        toast(data.error, 'error'); 
        document.querySelectorAll('.dungeon-card button').forEach(function(b) { b.disabled = false; });
        return; 
    }

    // Show intro for dungeon boss
    var bossEmoji = MONSTER_EMOJI[data.bossName] || '👹';
    await showMonsterIntro(data.bossName, bossEmoji, '??');

    const bd = $('dungeon-battle-display');
    bd.style.display = 'block';
    $('dg-player-name').textContent = currentChar.name;
    $('dg-player-icon').textContent = CLASS_EMOJI[currentChar.class] || '⚔️';
    $('dg-boss-name').textContent = data.bossName;

    // Setup HP bars for dungeon
    var dgPlayerMaxHp = currentChar.total_max_hp || currentChar.max_hp;
    var dgPlayerFill = $('dg-player-hp');
    var dgBossFill = $('dg-boss-hp');
    if (dgPlayerFill) setHpBarWithText(dgPlayerFill, dgPlayerMaxHp, dgPlayerMaxHp);

    // Track current monster HP dynamically
    var currentMonsterMaxHp = data.bossHp || 100;
    var currentMonsterName = data.bossName;
    if (dgBossFill) setHpBarWithText(dgBossFill, currentMonsterMaxHp, currentMonsterMaxHp);

    var dgPrevPlayerHp = dgPlayerMaxHp;

    const logEl = $('dungeon-log');
    logEl.innerHTML = '';
    $('dungeon-result').style.display = 'none';
    $('dungeon-result').classList.remove('confetti');

    for (let i = 0; i < data.log.length; i++) {
        await delay(350);
        const entry = data.log[i];
        const div = document.createElement('div');
        const cls = entry.actor === 'player' ? 'player-action' : entry.actor === 'monster' ? 'monster-action' : 'system-msg';
        div.className = 'log-entry ' + cls;
        div.innerHTML = formatLogMsg(entry.msg);
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;

        // Detect new monster/boss encounter from system messages
        if (entry.actor === 'system' && entry.msg) {
            var wildMatch = entry.msg.match(/wild (.+?) \(Lv\./);
            var bossMatch = entry.msg.match(/BOSS: (.+?) appears/);
            if (wildMatch || bossMatch) {
                var newName = wildMatch ? wildMatch[1] : bossMatch[1];
                currentMonsterName = newName;
                $('dg-boss-name').textContent = newName;
                // Estimate monster max HP from next log entries
                var nextMonsterHp = 0;
                for (var ni = i + 1; ni < data.log.length; ni++) {
                    if (data.log[ni].monsterHp !== undefined) {
                        // First entry with monsterHp tells us approx max
                        var firstDmg = 0;
                        var dmgMatch = data.log[ni].msg.match(/(\d+)/);
                        if (dmgMatch && data.log[ni].actor === 'player') firstDmg = parseInt(dmgMatch[0]);
                        nextMonsterHp = data.log[ni].monsterHp + firstDmg;
                        break;
                    }
                    if (data.log[ni].actor === 'system') break; // next encounter
                }
                if (nextMonsterHp > 0) currentMonsterMaxHp = nextMonsterHp;
                if (bossMatch) currentMonsterMaxHp = data.bossHp || currentMonsterMaxHp;
                if (dgBossFill) setHpBarWithText(dgBossFill, currentMonsterMaxHp, currentMonsterMaxHp);
                // Update boss icon emoji
                var mEmoji = MONSTER_EMOJI[newName] || '👹';
                $('dg-boss-icon').textContent = mEmoji;
            }
        }

        // Play sounds and animations for dungeon combat
        if (entry.actor === 'player') {
            AudioEngine.sfxAttack();
            triggerAnim('dg-player-icon', 'attack-anim-left', 400);
            setTimeout(function() {
                triggerAnim('dg-boss-icon', 'shake', 400);
                triggerAnim('dg-boss-icon', 'flash-red', 500);
            }, 150);
        } else if (entry.actor === 'monster') {
            AudioEngine.sfxAttack();
            triggerAnim('dg-boss-icon', 'attack-anim-right', 400);
            setTimeout(function() {
                triggerAnim('dg-player-icon', 'shake', 400);
                triggerAnim('dg-player-icon', 'flash-red', 500);
            }, 150);
        }

        // Update dungeon HP bars
        if (entry.playerHp !== undefined && dgPlayerFill) {
            setHpBarWithText(dgPlayerFill, entry.playerHp, dgPlayerMaxHp);
            if (entry.playerHp < dgPrevPlayerHp) {
                var pDmg = dgPrevPlayerHp - entry.playerHp;
                if (pDmg > dgPlayerMaxHp * 0.2) {
                    triggerAnim('dungeon-battle-display', 'screen-shake', 350);
                }
            }
            dgPrevPlayerHp = entry.playerHp;
        }
        if (entry.monsterHp !== undefined && dgBossFill) {
            setHpBarWithText(dgBossFill, Math.max(0, entry.monsterHp), currentMonsterMaxHp);
        }
    }

    await delay(400);
    const resultEl = $('dungeon-result');
    resultEl.style.display = 'block';
    resultEl.className = 'battle-result ' + (data.won ? 'victory' : 'defeat');

    // Play victory or defeat sound for dungeon
    if (data.won) {
        AudioEngine.sfxVictory();
        if (data.goldGained > 0) setTimeout(function() { AudioEngine.sfxGold(); }, 500);
    } else {
        AudioEngine.sfxPlayerDeath();
    }

    let resultHtml = data.won
        ? '<div>🎉 DUNGEON CLEARED: ' + data.dungeon + '!</div><div class="rewards">+' + data.xpGained + ' XP | +' + data.goldGained + ' Gold</div>'
        : '<div>💀 DUNGEON FAILED!</div><div style="font-size:8px;margin-top:6px;">You retreat battered and bruised...</div>';

    if (data.droppedItems && data.droppedItems.length > 0) {
        resultHtml += '<div class="drops">📦 Loot: ' + data.droppedItems.map(function(i) { return i.name; }).join(', ') + '</div>';
    }
    if (data.levelUps && data.levelUps.length > 0) {
        AudioEngine.sfxLevelUp();
        for (const lu of data.levelUps) {
            resultHtml += '<div class="level-up-msg">⭐ LEVEL UP! Lv.' + lu.level + '! HP+' + lu.hpGain + ' ATK+' + lu.atkGain + ' DEF+' + lu.defGain + '</div>';
        }
    }
    resultEl.innerHTML = resultHtml;

    // Victory confetti or defeat darken
    if (data.won) {
        showVictoryConfetti(resultEl);
    } else {
        showDefeatDarken();
    }

    currentChar = data.character;
    updateCharDisplay();
    
    // Switch back to adventure music
    if (bgmStarted) AudioEngine.switchBGM('adventure');

    // Re-enable dungeon buttons
    loadDungeons();
}

// ─── CRAFTING ───
async function loadRecipes() {
    const data = await api('/api/recipes');
    if (data.error) return;
    const grid = $('recipe-grid');
    grid.innerHTML = data.map(r => `
        <div class="recipe-card rarity-border-${r.result_rarity}">
            <div class="recipe-result rarity-${r.result_rarity}">
                ${getItemEmoji(r.result_type)} ${r.result_name}
                <span style="font-size:7px;color:var(--text-dim)">[${r.result_rarity}]</span>
            </div>
            <div class="recipe-ingredients">
                📦 ${r.ing1_name} x${r.ingredient1_qty} + ${r.ing2_name} x${r.ingredient2_qty}
            </div>
            <div class="recipe-stats">
                ${r.result_atk ? `<span class="stat-badge">⚔️ +${r.result_atk}</span>` : ''}
                ${r.result_def ? `<span class="stat-badge">🛡️ +${r.result_def}</span>` : ''}
                ${r.result_hp ? `<span class="stat-badge">❤️ +${r.result_hp}</span>` : ''}
            </div>
            <button class="btn btn-sm btn-primary" onclick="doCraft(${r.id})">🔨 CRAFT</button>
        </div>
    `).join('');
}

async function doCraft(recipeId) {
    const data = await api('/api/craft', { method: 'POST', body: { recipeId } });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxCraft();
    toast(data.message, 'success');
    loadRecipes();
    if (currentPanel === 'inventory') loadInventory();
}

// ─── PVP ───
function updatePvPList() {
    const list = $('pvp-list');
    const opponents = onlinePlayers.filter(p => p.charId !== myCharId);
    if (opponents.length === 0) {
        list.innerHTML = '<p style="color:var(--text-dim);font-size:9px;">No other players online. Invite your friends!</p>';
        return;
    }
    // FIX #1: Escape names in PvP list to prevent XSS
    list.innerHTML = opponents.map(p => `
        <div class="pvp-player-card">
            <div class="pvp-name">${CLASS_EMOJI[p.class] || ''} ${escapeHtml(p.name)}</div>
            <div class="pvp-class">${p.class}</div>
            <div class="pvp-level">Level ${p.level}</div>
            <button class="btn btn-sm btn-danger" onclick="doPvP(${p.charId})">⚡ DUEL</button>
        </div>
    `).join('');
}

async function doPvP(targetCharId) {
    AudioEngine.sfxDuelStart();
    const data = await api('/api/pvp/duel', { method: 'POST', body: { targetCharId } });
    if (data.error) { toast(data.error, 'error'); return; }

    const bd = $('pvp-battle-display');
    bd.style.display = 'block';
    const logEl = $('pvp-log');
    logEl.innerHTML = '';
    $('pvp-result').style.display = 'none';
    $('pvp-result').classList.remove('confetti');

    for (let i = 0; i < data.log.length; i++) {
        await delay(350);
        const entry = data.log[i];
        const div = document.createElement('div');
        div.className = 'log-entry ' + (entry.actor === 'player' ? 'player-action' : 'monster-action');
        div.innerHTML = formatLogMsg(entry.msg);
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;

        // Play attack sound for PvP hits
        AudioEngine.sfxAttack();

        // Screen shake on every hit in PvP for intensity
        triggerAnim(bd, 'screen-shake', 300);
    }

    await delay(400);
    const resultEl = $('pvp-result');
    resultEl.style.display = 'block';
    resultEl.className = 'battle-result ' + (data.won ? 'victory' : 'defeat');

    // Play victory or defeat sound for PvP
    if (data.won) {
        AudioEngine.sfxVictory();
        setTimeout(function() { AudioEngine.sfxGold(); }, 500);
    } else {
        AudioEngine.sfxPlayerDeath();
    }

    resultEl.innerHTML = data.won
        ? '<div>🏆 YOU WIN vs ' + escapeHtml(data.opponent.name) + '!</div><div class="rewards">+' + data.goldWon + ' Gold | +' + data.xpGained + ' XP</div>'
        : '<div>💀 YOU LOST to ' + escapeHtml(data.opponent.name) + '!</div><div class="rewards">' + data.goldWon + ' Gold</div>';

    // Victory confetti or defeat darken
    if (data.won) {
        showVictoryConfetti(resultEl);
    } else {
        showDefeatDarken();
    }

    currentChar = data.character;
    updateCharDisplay();
}

// ─── REST ───
async function doRest() {
    const btn = $('btn-rest');
    if (btn.disabled) return;

    const data = await api('/api/rest', { method: 'POST' });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxHeal();
    toast(`Rested and healed! (-${data.cost}G)`, 'success');
    currentChar = data.character;
    updateCharDisplay();

    // Rest cooldown (30 seconds)
    startRestCooldown();
}

function startRestCooldown() {
    const btn = $('btn-rest');
    let remaining = 30;
    btn.disabled = true;
    btn.textContent = `💤 ${remaining}s`;
    btn.classList.add('on-cooldown');
    restCooldownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(restCooldownTimer);
            restCooldownTimer = null;
            btn.disabled = false;
            btn.textContent = '💤 Rest';
            btn.classList.remove('on-cooldown');
        } else {
            btn.textContent = `💤 ${remaining}s`;
        }
    }, 1000);
}

// ─── DAILY REWARD ───
async function claimDaily() {
    const btn = $('btn-daily');
    btn.disabled = true;
    const data = await api('/api/daily-reward', { method: 'POST' });
    if (data.error) {
        toast(data.error, 'error');
        btn.disabled = false;
        return;
    }
    AudioEngine.sfxGold();
    toast(`🎁 Daily Reward! +${data.goldReward}G +${data.xpReward}XP (Streak: ${data.streak}🔥)`, 'gold');

    if (data.levelUps && data.levelUps.length > 0) {
        AudioEngine.sfxLevelUp();
        for (const lu of data.levelUps) {
            toast(`⭐ LEVEL UP! Lv.${lu.level}!`, 'success');
        }
    }

    currentChar = data.character;
    updateCharDisplay();
    // Keep button disabled - already claimed today
    btn.textContent = '✅ Claimed';
    btn.classList.add('claimed');
}

// ─── STATS ───
async function loadStats() {
    const data = await api('/api/stats');
    if (data.error) return;

    const container = $('stats-container');
    let html = '<div class="stats-overview">';
    html += '<div class="stat-card"><div class="stat-card-label">🗡️ Total Kills</div><div class="stat-card-value">' + data.totalKills + '</div></div>';
    html += '<div class="stat-card"><div class="stat-card-label">💰 Total Gold Earned</div><div class="stat-card-value">' + data.totalGoldEarned + 'G</div></div>';
    html += '<div class="stat-card"><div class="stat-card-label">🔥 Daily Streak</div><div class="stat-card-value">' + data.dailyStreak + ' days</div></div>';
    html += '</div>';

    if (data.kills.length > 0) {
        html += '<h3 style="margin-top:16px;margin-bottom:8px;font-size:9px;">🏆 Kill Counts</h3>';
        html += '<div class="kill-list">';
        for (const k of data.kills) {
            const emoji = MONSTER_EMOJI[k.monster_name] || '👹';
            html += '<div class="kill-entry">';
            html += '<span class="kill-name">' + emoji + ' ' + k.monster_name + '</span>';
            html += '<span class="kill-count">x' + k.kill_count + '</span>';
            html += '</div>';
        }
        html += '</div>';
    } else {
        html += '<p style="color:var(--text-dim);font-size:8px;margin-top:16px;">No kills yet. Go hunt some monsters!</p>';
    }

    container.innerHTML = html;
}

// ─── CHAT ───
function sendChat() {
    const input = $('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat-message', msg);
    input.value = '';
}

$('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
});

function addChatMsg(data) {
    const container = $('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    // FIX #1: Escape both charName and message to prevent XSS
    div.innerHTML = `<span class="msg-author">${escapeHtml(data.charName)}:</span> <span class="msg-text">${escapeHtml(data.message)}</span> <span class="msg-time">${time}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── SOCKET EVENTS ───
socket.on('chat-message', (data) => addChatMsg(data));

socket.on('chat-history', (messages) => {
    $('chat-messages').innerHTML = '';
    messages.forEach(m => addChatMsg(m));
});

socket.on('online-players', (players) => {
    onlinePlayers = players;
    $('online-count').textContent = players.length;
    const list = $('online-list');
    // FIX #1: Escape player names to prevent XSS
    list.innerHTML = players.map(p => `
        <div class="online-player">
            <span class="player-dot"></span>
            <span class="p-info">${CLASS_EMOJI[p.class] || ''} ${escapeHtml(p.name)}</span>
            <span class="p-level">Lv.${p.level}</span>
        </div>
    `).join('');

    if (currentPanel === 'pvp') updatePvPList();
});

socket.on('pvp-result', (data) => {
    if (data.won) {
        toast(`${data.attackerName} dueled you and you WON! +${data.goldStake}G`, 'success');
    } else {
        toast(`${data.attackerName} dueled you and you LOST! -${data.goldStake}G`, 'error');
    }
    // Refresh character
    api('/api/character').then(d => { if (!d.error) { currentChar = d; updateCharDisplay(); } });
});

// Enter key for auth forms
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        if ($('auth-screen').style.display !== 'none') {
            if ($('login-form').style.display !== 'none') doLogin();
            else doRegister();
        }
    }
});

// ─── QUEST / DAILY MISSIONS ───
async function loadQuests() {
    var data = await api('/api/quests');
    if (data.error) return;
    var container = $('quest-container');
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = '<p style="color:var(--text-dim);font-size:8px;">No quests available.</p>';
        return;
    }

    var html = '';
    for (var i = 0; i < data.length; i++) {
        var q = data[i];
        var pct = Math.min(100, Math.floor((q.current_count / q.target_count) * 100));
        var statusCls = q.claimed ? 'quest-claimed' : q.completed ? 'quest-done' : 'quest-active';
        var icon = q.quest_type === 'hunt' ? '🗡️' : q.quest_type === 'pvp_win' ? '⚡' : '🏰';
        html += '<div class="quest-card ' + statusCls + '">';
        html += '<div class="quest-header">' + icon + ' ' + escapeHtml(q.quest_desc) + '</div>';
        html += '<div class="quest-progress-bar"><div class="quest-progress-fill" style="width:' + pct + '%"></div></div>';
        html += '<div class="quest-info">' + q.current_count + '/' + q.target_count + ' | 🏆 ' + q.reward_xp + ' XP + ' + q.reward_gold + ' Gold</div>';
        if (q.completed && !q.claimed) {
            html += '<button class="btn btn-sm btn-success" onclick="claimQuest(' + q.id + ')">🎁 CLAIM</button>';
        } else if (q.claimed) {
            html += '<span class="quest-badge-claimed">✅ Claimed</span>';
        }
        html += '</div>';
    }
    container.innerHTML = html;
}

async function claimQuest(questId) {
    var data = await api('/api/quests/claim', { method: 'POST', body: { questId: questId } });
    if (data.error) { toast(data.error, 'error'); return; }
    AudioEngine.sfxGold();
    toast(data.message, 'gold');
    if (data.levelUps && data.levelUps.length > 0) {
        AudioEngine.sfxLevelUp();
        for (var i = 0; i < data.levelUps.length; i++) {
            toast('⭐ LEVEL UP! Lv.' + data.levelUps[i].level + '!', 'success');
        }
    }
    currentChar = data.character;
    updateCharDisplay();
    loadQuests();
}

// ─── TUTORIAL / ONBOARDING ───
var tutorialSteps = [
    { title: '👋 Welcome, Adventurer!', text: 'Welcome to Epic RPG! Here are some tips to get you started.' },
    { title: '⚔️ Hunting', text: 'Click the Hunt tab to battle monsters. Defeat them for XP, Gold, and loot drops!' },
    { title: '🏰 Dungeons', text: 'Enter dungeons in the Adventure tab for tougher fights and better rewards.' },
    { title: '🎒 Inventory', text: 'Equip weapons and armor to boost your stats. Use potions to heal or gain buffs.' },
    { title: '🛒 Shop & Craft', text: 'Buy items from the Shop or craft powerful gear from materials you find.' },
    { title: '⚡ PvP', text: 'Challenge other online players in the PvP Arena. Winner takes gold!' },
    { title: '🎁 Daily Rewards', text: 'Claim your daily reward and complete daily quests for bonus XP and Gold!' },
    { title: '🚀 Go Adventure!', text: 'You are ready! Start by hunting some monsters. Good luck!' }
];
var tutorialStep = 0;

async function checkTutorial() {
    var data = await api('/api/tutorial/status');
    if (data.error || data.tutorialSeen) return;
    showTutorial();
}

function showTutorial() {
    tutorialStep = 0;
    var overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.className = 'tutorial-overlay';
    renderTutorialStep(overlay);
    document.body.appendChild(overlay);
}

function renderTutorialStep(overlay) {
    if (!overlay) overlay = $('tutorial-overlay');
    if (!overlay) return;
    var step = tutorialSteps[tutorialStep];
    var isLast = tutorialStep === tutorialSteps.length - 1;
    overlay.innerHTML = '<div class="tutorial-card">' +
        '<div class="tutorial-step-indicator">' + (tutorialStep + 1) + '/' + tutorialSteps.length + '</div>' +
        '<h3 class="tutorial-title">' + step.title + '</h3>' +
        '<p class="tutorial-text">' + step.text + '</p>' +
        '<div class="tutorial-actions">' +
        (tutorialStep > 0 ? '<button class="btn btn-sm btn-primary" onclick="tutorialPrev()">◀ Back</button>' : '') +
        '<button class="btn btn-sm ' + (isLast ? 'btn-success' : 'btn-primary') + '" onclick="' + (isLast ? 'tutorialDone()' : 'tutorialNext()') + '">' + (isLast ? '✅ Got it!' : 'Next ▶') + '</button>' +
        '</div>' +
        '<button class="tutorial-skip" onclick="tutorialDone()">Skip tutorial</button>' +
        '</div>';
}

function tutorialNext() {
    tutorialStep++;
    if (tutorialStep >= tutorialSteps.length) { tutorialDone(); return; }
    renderTutorialStep();
}

function tutorialPrev() {
    if (tutorialStep > 0) tutorialStep--;
    renderTutorialStep();
}

async function tutorialDone() {
    var overlay = $('tutorial-overlay');
    if (overlay) overlay.remove();
    await api('/api/tutorial/complete', { method: 'POST' });
}

// ─── INIT ───
checkSession();
