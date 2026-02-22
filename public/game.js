// ─── Socket.io ───
const socket = io();

// ─── State ───
let currentChar = null;
let currentPanel = 'hunt';
let shopItems = [];
let onlinePlayers = [];
let myCharId = null;

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
    const username = $('login-user').value.trim();
    const password = $('login-pass').value;
    if (!username || !password) { $('auth-error').textContent = 'Fill in all fields!'; return; }
    const data = await api('/api/login', { method: 'POST', body: { username, password } });
    if (data.error) { $('auth-error').textContent = data.error; return; }
    toast('Login successful!', 'success');
    checkSession();
}

async function doRegister() {
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

    const atkText = c.bonus_atk ? `${c.total_atk} (+${c.bonus_atk})` : `${c.atk}`;
    const defText = c.bonus_def ? `${c.total_def} (+${c.bonus_def})` : `${c.def}`;
    $('stat-atk').innerHTML = atkText;
    $('stat-def').innerHTML = defText;
    $('stat-gold').textContent = c.gold;
}

// ─── PANEL SWITCHING ───
function switchPanel(panel) {
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
}

// ─── HUNT ───
async function doHunt() {
    const btn = $('hunt-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Hunting...';

    const data = await api('/api/hunt', { method: 'POST' });
    if (data.error) {
        toast(data.error, 'error');
        btn.disabled = false;
        btn.textContent = '🗡️ GO HUNTING!';
        return;
    }

    // Show battle display
    const bd = $('battle-display');
    bd.style.display = 'block';
    const monsterEmoji = MONSTER_EMOJI[data.monster.name] || '👹';
    $('monster-battle-icon').textContent = monsterEmoji;
    $('monster-battle-name').textContent = `${data.monster.name} Lv.${data.monster.level}`;
    $('player-battle-name').textContent = currentChar.name;
    $('player-battle-icon').textContent = CLASS_EMOJI[currentChar.class] || '⚔️';

    // Animate battle log
    const logEl = $('battle-log');
    logEl.innerHTML = '';
    $('battle-result').style.display = 'none';

    for (let i = 0; i < data.log.length; i++) {
        await delay(300);
        const entry = data.log[i];
        const div = document.createElement('div');
        div.className = `log-entry ${entry.actor === 'player' ? 'player-action' : 'monster-action'}`;
        div.textContent = entry.msg;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;

        // Update HP bars
        if (entry.playerHp !== undefined) {
            const maxHp = currentChar.total_max_hp || currentChar.max_hp;
            $('player-hp-fill').style.width = `${Math.max(0, (entry.playerHp / maxHp) * 100)}%`;
        }
        if (entry.monsterHp !== undefined) {
            const monMaxHp = data.log[0]?.monsterHp + (data.log[0]?.actor === 'player' ? parseInt(data.log[0].msg.match(/\d+/)?.[0] || 0) : 0);
            const mMax = monMaxHp || 100;
            $('monster-hp-fill').style.width = `${Math.max(0, (entry.monsterHp / mMax) * 100)}%`;
        }
    }

    // Show result
    await delay(400);
    const resultEl = $('battle-result');
    resultEl.style.display = 'block';
    resultEl.className = `battle-result ${data.won ? 'victory' : 'defeat'}`;

    let resultHtml = data.won
        ? `<div>🎉 VICTORY!</div><div class="rewards">+${data.xpGained} XP | +${data.goldGained} Gold</div>`
        : `<div>💀 DEFEATED!</div><div style="font-size:8px;margin-top:6px;">You retreat and recover...</div>`;

    if (data.droppedItems.length > 0) {
        resultHtml += `<div class="drops">📦 Loot: ${data.droppedItems.map(i => i.name).join(', ')}</div>`;
    }

    if (data.levelUps.length > 0) {
        for (const lu of data.levelUps) {
            resultHtml += `<div class="level-up-msg">⭐ LEVEL UP! Now Level ${lu.level}! HP+${lu.hpGain} ATK+${lu.atkGain} DEF+${lu.defGain}</div>`;
        }
    }

    resultEl.innerHTML = resultHtml;

    // Update character
    currentChar = data.character;
    updateCharDisplay();

    btn.disabled = false;
    btn.textContent = '🗡️ GO HUNTING!';
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
                <button class="btn btn-sm btn-danger" onclick="sellItem(${item.inv_id})">SELL (${Math.floor(item.price * 0.5)}G)</button>
            </div>
        </div>
    `).join('');
}

async function equipItem(invId) {
    const data = await api('/api/inventory/equip', { method: 'POST', body: { invId } });
    if (data.error) { toast(data.error, 'error'); return; }
    toast('Equipment updated!', 'success');
    loadInventory();
    const charData = await api('/api/character');
    if (!charData.error) { currentChar = charData; updateCharDisplay(); }
}

async function useItem(invId) {
    const data = await api('/api/inventory/use', { method: 'POST', body: { invId } });
    if (data.error) { toast(data.error, 'error'); return; }
    toast(`Healed ${data.healed} HP!`, 'success');
    currentChar = data.character;
    updateCharDisplay();
    loadInventory();
}

async function sellItem(invId) {
    const data = await api('/api/shop/sell', { method: 'POST', body: { invId } });
    if (data.error) { toast(data.error, 'error'); return; }
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
    const data = await api('/api/dungeon/enter', { method: 'POST', body: { dungeonId } });
    if (data.error) { toast(data.error, 'error'); return; }

    const bd = $('dungeon-battle-display');
    bd.style.display = 'block';
    $('dg-player-name').textContent = currentChar.name;
    $('dg-player-icon').textContent = CLASS_EMOJI[currentChar.class] || '⚔️';
    $('dg-boss-name').textContent = data.bossName;

    const logEl = $('dungeon-log');
    logEl.innerHTML = '';
    $('dungeon-result').style.display = 'none';

    for (let i = 0; i < data.log.length; i++) {
        await delay(200);
        const entry = data.log[i];
        const div = document.createElement('div');
        const cls = entry.actor === 'player' ? 'player-action' : entry.actor === 'monster' ? 'monster-action' : 'system-msg';
        div.className = `log-entry ${cls}`;
        div.textContent = entry.msg;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
    }

    await delay(400);
    const resultEl = $('dungeon-result');
    resultEl.style.display = 'block';
    resultEl.className = `battle-result ${data.won ? 'victory' : 'defeat'}`;

    let resultHtml = data.won
        ? `<div>🎉 DUNGEON CLEARED: ${data.dungeon}!</div><div class="rewards">+${data.xpGained} XP | +${data.goldGained} Gold</div>`
        : `<div>💀 DUNGEON FAILED!</div><div style="font-size:8px;margin-top:6px;">You retreat battered and bruised...</div>`;

    if (data.droppedItems && data.droppedItems.length > 0) {
        resultHtml += `<div class="drops">📦 Loot: ${data.droppedItems.map(i => i.name).join(', ')}</div>`;
    }
    if (data.levelUps && data.levelUps.length > 0) {
        for (const lu of data.levelUps) {
            resultHtml += `<div class="level-up-msg">⭐ LEVEL UP! Lv.${lu.level}! HP+${lu.hpGain} ATK+${lu.atkGain} DEF+${lu.defGain}</div>`;
        }
    }
    resultEl.innerHTML = resultHtml;

    currentChar = data.character;
    updateCharDisplay();
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
    list.innerHTML = opponents.map(p => `
        <div class="pvp-player-card">
            <div class="pvp-name">${CLASS_EMOJI[p.class] || ''} ${p.name}</div>
            <div class="pvp-class">${p.class}</div>
            <div class="pvp-level">Level ${p.level}</div>
            <button class="btn btn-sm btn-danger" onclick="doPvP(${p.charId})">⚡ DUEL</button>
        </div>
    `).join('');
}

async function doPvP(targetCharId) {
    const data = await api('/api/pvp/duel', { method: 'POST', body: { targetCharId } });
    if (data.error) { toast(data.error, 'error'); return; }

    const bd = $('pvp-battle-display');
    bd.style.display = 'block';
    const logEl = $('pvp-log');
    logEl.innerHTML = '';
    $('pvp-result').style.display = 'none';

    for (let i = 0; i < data.log.length; i++) {
        await delay(300);
        const entry = data.log[i];
        const div = document.createElement('div');
        div.className = `log-entry ${entry.actor === 'player' ? 'player-action' : 'monster-action'}`;
        div.textContent = entry.msg;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
    }

    await delay(400);
    const resultEl = $('pvp-result');
    resultEl.style.display = 'block';
    resultEl.className = `battle-result ${data.won ? 'victory' : 'defeat'}`;
    resultEl.innerHTML = data.won
        ? `<div>🏆 YOU WIN vs ${data.opponent.name}!</div><div class="rewards">+${data.goldWon} Gold | +${data.xpGained} XP</div>`
        : `<div>💀 YOU LOST to ${data.opponent.name}!</div><div class="rewards">${data.goldWon} Gold</div>`;

    currentChar = data.character;
    updateCharDisplay();
}

// ─── REST ───
async function doRest() {
    const data = await api('/api/rest', { method: 'POST' });
    if (data.error) { toast(data.error, 'error'); return; }
    toast(`Rested and healed! (-${data.cost}G)`, 'success');
    currentChar = data.character;
    updateCharDisplay();
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
    div.innerHTML = `<span class="msg-author">${data.charName}:</span> <span class="msg-text">${escapeHtml(data.message)}</span> <span class="msg-time">${time}</span>`;
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
    list.innerHTML = players.map(p => `
        <div class="online-player">
            <span class="player-dot"></span>
            <span class="p-info">${CLASS_EMOJI[p.class] || ''} ${p.name}</span>
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

// ─── INIT ───
checkSession();
