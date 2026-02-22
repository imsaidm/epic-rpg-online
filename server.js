const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// ─── App Setup ───
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SESSION_SECRET = 'epic-rpg-secret-key-' + crypto.randomBytes(8).toString('hex');
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// Share session with Socket.io
io.engine.use(sessionMiddleware);

// ─── Database Setup ───
const dbPath = path.join(__dirname, 'db', 'game.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run init SQL
const initSQL = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
db.exec(initSQL);

console.log('✅ Database initialized');

// ─── Helper Functions ───
function hashPassword(pw) {
    return crypto.createHash('sha256').update(pw).digest('hex');
}

function xpForLevel(level) {
    return Math.floor(50 * Math.pow(level, 1.8));
}

function getCharWithEquipBonus(charId) {
    const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId);
    if (!char) return null;
    const equipped = db.prepare(`
        SELECT i.atk_bonus, i.def_bonus, i.hp_bonus FROM inventory inv
        JOIN items i ON inv.item_id = i.id
        WHERE inv.character_id = ? AND inv.equipped = 1
    `).all(charId);
    let bonusAtk = 0, bonusDef = 0, bonusHp = 0;
    for (const e of equipped) {
        bonusAtk += e.atk_bonus;
        bonusDef += e.def_bonus;
        bonusHp += e.hp_bonus;
    }
    return {
        ...char,
        total_atk: char.atk + bonusAtk,
        total_def: char.def + bonusDef,
        total_max_hp: char.max_hp + bonusHp,
        bonus_atk: bonusAtk,
        bonus_def: bonusDef,
        bonus_hp: bonusHp
    };
}

function checkLevelUp(char) {
    const needed = xpForLevel(char.level);
    const results = [];
    while (char.xp >= needed) {
        char.xp -= xpForLevel(char.level);
        char.level += 1;
        // Stat gains per level based on class
        let hpGain = 10, atkGain = 2, defGain = 1;
        if (char.class === 'Warrior') { hpGain = 15; atkGain = 3; defGain = 2; }
        else if (char.class === 'Mage') { hpGain = 8; atkGain = 4; defGain = 1; }
        else if (char.class === 'Archer') { hpGain = 10; atkGain = 3; defGain = 1; }
        char.max_hp += hpGain;
        char.hp = char.max_hp;
        char.atk += atkGain;
        char.def += defGain;
        results.push({ level: char.level, hpGain, atkGain, defGain });
        if (char.xp < xpForLevel(char.level)) break;
    }
    if (results.length > 0) {
        db.prepare(`UPDATE characters SET level=?, xp=?, hp=?, max_hp=?, atk=?, def=? WHERE id=?`)
            .run(char.level, char.xp, char.hp, char.max_hp, char.atk, char.def, char.id);
    }
    return results;
}

// Online players tracking
const onlinePlayers = new Map(); // socketId -> { charId, charName, userId }

// ─── AUTH ROUTES ───
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ error: 'Username and password required' });
    if (username.length < 3 || username.length > 20) return res.json({ error: 'Username must be 3-20 characters' });
    if (password.length < 4) return res.json({ error: 'Password must be at least 4 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.json({ error: 'Username already taken' });

    const hash = hashPassword(password);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    req.session.userId = result.lastInsertRowid;
    req.session.username = username;
    res.json({ success: true, userId: result.lastInsertRowid });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || user.password_hash !== hashPassword(password)) {
        return res.json({ error: 'Invalid username or password' });
    }
    req.session.userId = user.id;
    req.session.username = username;
    res.json({ success: true, userId: user.id });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    const char = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(req.session.userId);
    res.json({ loggedIn: true, userId: req.session.userId, username: req.session.username, character: char || null });
});

// ─── CHARACTER ROUTES ───
app.post('/api/character/create', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const { name, charClass } = req.body;
    if (!name || !charClass) return res.json({ error: 'Name and class required' });
    if (!['Warrior', 'Mage', 'Archer'].includes(charClass)) return res.json({ error: 'Invalid class' });

    const existing = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (existing) return res.json({ error: 'You already have a character' });

    let hp = 100, atk = 10, def = 5;
    if (charClass === 'Warrior') { hp = 120; atk = 12; def = 8; }
    else if (charClass === 'Mage') { hp = 80; atk = 15; def = 4; }
    else if (charClass === 'Archer') { hp = 90; atk = 13; def = 5; }

    const result = db.prepare(
        'INSERT INTO characters (user_id, name, class, hp, max_hp, atk, def) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.session.userId, name, charClass, hp, hp, atk, def);

    // Give starter items
    const starterWeapon = charClass === 'Mage' ? 7 : charClass === 'Archer' ? 8 : 1;
    db.prepare('INSERT INTO inventory (character_id, item_id, quantity, equipped) VALUES (?, ?, 1, 1)').run(result.lastInsertRowid, starterWeapon);
    db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, 17, 3)').run(result.lastInsertRowid);

    const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, character: char });
});

app.get('/api/character', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const char = getCharWithEquipBonus(
        db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId)?.id
    );
    if (!char) return res.json({ error: 'No character found' });
    char.xp_needed = xpForLevel(char.level);
    res.json(char);
});

// ─── HUNT ROUTE ───
app.post('/api/hunt', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const char = getCharWithEquipBonus(charRow.id);

    // Pick random monster near player level
    const minLv = Math.max(1, char.level - 2);
    const maxLv = char.level + 2;
    const monsters = db.prepare('SELECT * FROM monsters WHERE level BETWEEN ? AND ?').all(minLv, maxLv);
    if (monsters.length === 0) {
        // fallback: any monster
        const all = db.prepare('SELECT * FROM monsters ORDER BY level').all();
        monsters.push(all[0]);
    }
    const monster = monsters[Math.floor(Math.random() * monsters.length)];

    // Battle simulation
    let playerHp = char.hp;
    let monsterHp = monster.hp;
    const log = [];
    let turn = 0;

    while (playerHp > 0 && monsterHp > 0 && turn < 20) {
        turn++;
        // Player attacks
        const playerDmg = Math.max(1, char.total_atk - monster.def + Math.floor(Math.random() * 5) - 2);
        monsterHp -= playerDmg;
        log.push({ actor: 'player', msg: `You deal ${playerDmg} damage to ${monster.name}!`, playerHp, monsterHp: Math.max(0, monsterHp) });

        if (monsterHp <= 0) break;

        // Monster attacks
        const monsterDmg = Math.max(1, monster.atk - char.total_def + Math.floor(Math.random() * 5) - 2);
        playerHp -= monsterDmg;
        log.push({ actor: 'monster', msg: `${monster.name} deals ${monsterDmg} damage to you!`, playerHp: Math.max(0, playerHp), monsterHp });
    }

    const won = monsterHp <= 0;
    let xpGained = 0, goldGained = 0, droppedItems = [], levelUps = [];

    if (won) {
        xpGained = monster.xp_reward;
        goldGained = monster.gold_reward + Math.floor(Math.random() * 5);

        // Drop chance
        if (monster.drops) {
            const dropIds = monster.drops.split(',').map(Number);
            for (const did of dropIds) {
                if (Math.random() < 0.35) {
                    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(did);
                    if (item) {
                        const existingInv = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(char.id, did);
                        if (existingInv) {
                            db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(existingInv.id);
                        } else {
                            db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)').run(char.id, did);
                        }
                        droppedItems.push(item);
                    }
                }
            }
        }

        // Update char
        const newXp = char.xp + xpGained;
        const newGold = char.gold + goldGained;
        const newHp = Math.max(1, playerHp);
        db.prepare('UPDATE characters SET xp = ?, gold = ?, hp = ? WHERE id = ?').run(newXp, newGold, newHp, char.id);

        // Check level up
        const updatedChar = db.prepare('SELECT * FROM characters WHERE id = ?').get(char.id);
        levelUps = checkLevelUp(updatedChar);
    } else {
        // Lost — lose some HP but don't die
        db.prepare('UPDATE characters SET hp = ? WHERE id = ?').run(Math.max(1, Math.floor(char.max_hp * 0.3)), char.id);
    }

    const finalChar = getCharWithEquipBonus(char.id);
    finalChar.xp_needed = xpForLevel(finalChar.level);

    res.json({
        won,
        monster: { name: monster.name, level: monster.level },
        log,
        xpGained,
        goldGained,
        droppedItems,
        levelUps,
        character: finalChar
    });
});

// ─── INVENTORY ROUTE ───
app.get('/api/inventory', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const char = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!char) return res.json({ error: 'No character' });

    const inv = db.prepare(`
        SELECT inv.id as inv_id, inv.quantity, inv.equipped, i.*
        FROM inventory inv JOIN items i ON inv.item_id = i.id
        WHERE inv.character_id = ?
        ORDER BY i.type, i.rarity DESC, i.name
    `).all(char.id);
    res.json(inv);
});

app.post('/api/inventory/equip', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const char = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!char) return res.json({ error: 'No character' });
    const { invId } = req.body;

    const invItem = db.prepare(`SELECT inv.*, i.type FROM inventory inv JOIN items i ON inv.item_id = i.id WHERE inv.id = ? AND inv.character_id = ?`).get(invId, char.id);
    if (!invItem) return res.json({ error: 'Item not found' });
    if (invItem.type === 'material' || invItem.type === 'potion') return res.json({ error: 'Cannot equip this item type' });

    // Unequip same-type items
    db.prepare(`UPDATE inventory SET equipped = 0 WHERE character_id = ? AND item_id IN (SELECT id FROM items WHERE type = ?)`)
        .run(char.id, invItem.type);
    // Equip
    db.prepare('UPDATE inventory SET equipped = ? WHERE id = ?').run(invItem.equipped ? 0 : 1, invId);

    res.json({ success: true });
});

app.post('/api/inventory/use', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const { invId } = req.body;

    const invItem = db.prepare(`SELECT inv.*, i.* FROM inventory inv JOIN items i ON inv.item_id = i.id WHERE inv.id = ? AND inv.character_id = ?`).get(invId, charRow.id);
    if (!invItem) return res.json({ error: 'Item not found' });
    if (invItem.type !== 'potion') return res.json({ error: 'Can only use potions' });

    const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(charRow.id);
    const newHp = Math.min(char.max_hp, char.hp + invItem.hp_bonus);
    db.prepare('UPDATE characters SET hp = ? WHERE id = ?').run(newHp, char.id);

    // Decrease quantity
    if (invItem.quantity > 1) {
        db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(invId);
    } else {
        db.prepare('DELETE FROM inventory WHERE id = ?').run(invId);
    }

    const finalChar = getCharWithEquipBonus(char.id);
    finalChar.xp_needed = xpForLevel(finalChar.level);
    res.json({ success: true, healed: invItem.hp_bonus, character: finalChar });
});

// ─── SHOP ROUTES ───
app.get('/api/shop', (req, res) => {
    const items = db.prepare('SELECT * FROM items WHERE type IN ("weapon","armor","potion") ORDER BY type, price').all();
    res.json(items);
});

app.post('/api/shop/buy', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const { itemId } = req.body;

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) return res.json({ error: 'Item not found' });

    const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(charRow.id);
    if (char.gold < item.price) return res.json({ error: 'Not enough gold!' });

    db.prepare('UPDATE characters SET gold = gold - ? WHERE id = ?').run(item.price, char.id);

    const existing = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(char.id, itemId);
    if (existing) {
        db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(existing.id);
    } else {
        db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)').run(char.id, itemId);
    }

    res.json({ success: true, message: `Bought ${item.name} for ${item.price} gold!` });
});

app.post('/api/shop/sell', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const { invId } = req.body;

    const invItem = db.prepare(`SELECT inv.*, i.price, i.name FROM inventory inv JOIN items i ON inv.item_id = i.id WHERE inv.id = ? AND inv.character_id = ?`).get(invId, charRow.id);
    if (!invItem) return res.json({ error: 'Item not found' });

    const sellPrice = Math.floor(invItem.price * 0.5);

    if (invItem.quantity > 1) {
        db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE id = ?').run(invId);
    } else {
        db.prepare('DELETE FROM inventory WHERE id = ?').run(invId);
    }
    db.prepare('UPDATE characters SET gold = gold + ? WHERE id = ?').run(sellPrice, charRow.id);

    res.json({ success: true, message: `Sold ${invItem.name} for ${sellPrice} gold!` });
});

// ─── DUNGEON / ADVENTURE ROUTES ───
app.get('/api/dungeons', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const dungeons = db.prepare('SELECT * FROM dungeons ORDER BY level_req').all();
    res.json(dungeons);
});

app.post('/api/dungeon/enter', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const char = getCharWithEquipBonus(charRow.id);
    const { dungeonId } = req.body;

    const dungeon = db.prepare('SELECT * FROM dungeons WHERE id = ?').get(dungeonId);
    if (!dungeon) return res.json({ error: 'Dungeon not found' });
    if (char.level < dungeon.level_req) return res.json({ error: `Requires level ${dungeon.level_req}! You are level ${char.level}.` });

    // Mini monsters before boss (2-3 encounters)
    const miniCount = 2 + Math.floor(Math.random() * 2);
    const allLog = [];
    let playerHp = char.hp;
    let totalXp = 0, totalGold = 0;

    // Mini encounters
    const areaMonsters = db.prepare('SELECT * FROM monsters WHERE level BETWEEN ? AND ? ORDER BY RANDOM() LIMIT ?')
        .all(Math.max(1, dungeon.level_req - 2), dungeon.level_req + 2, miniCount);

    for (const mini of areaMonsters) {
        let mHp = mini.hp;
        allLog.push({ actor: 'system', msg: `⚔️ A wild ${mini.name} (Lv.${mini.level}) appears!` });
        let turns = 0;
        while (playerHp > 0 && mHp > 0 && turns < 15) {
            turns++;
            const pDmg = Math.max(1, char.total_atk - mini.def + Math.floor(Math.random() * 5) - 2);
            mHp -= pDmg;
            allLog.push({ actor: 'player', msg: `You deal ${pDmg} dmg to ${mini.name}!`, playerHp, monsterHp: Math.max(0, mHp) });
            if (mHp <= 0) {
                totalXp += mini.xp_reward;
                totalGold += mini.gold_reward;
                allLog.push({ actor: 'system', msg: `${mini.name} defeated! +${mini.xp_reward} XP +${mini.gold_reward} Gold` });
                break;
            }
            const mDmg = Math.max(1, mini.atk - char.total_def + Math.floor(Math.random() * 5) - 2);
            playerHp -= mDmg;
            allLog.push({ actor: 'monster', msg: `${mini.name} deals ${mDmg} dmg!`, playerHp: Math.max(0, playerHp), monsterHp: mHp });
        }
        if (playerHp <= 0) break;
    }

    // Boss fight
    let bossDefeated = false;
    const droppedItems = [];
    if (playerHp > 0) {
        allLog.push({ actor: 'system', msg: `\n👹 BOSS: ${dungeon.boss_name} appears!` });
        let bossHp = dungeon.boss_hp;
        let turns = 0;
        while (playerHp > 0 && bossHp > 0 && turns < 30) {
            turns++;
            const pDmg = Math.max(1, char.total_atk - dungeon.boss_def + Math.floor(Math.random() * 8) - 3);
            bossHp -= pDmg;
            allLog.push({ actor: 'player', msg: `You deal ${pDmg} dmg to ${dungeon.boss_name}!`, playerHp, monsterHp: Math.max(0, bossHp) });
            if (bossHp <= 0) {
                bossDefeated = true;
                break;
            }
            const bDmg = Math.max(1, dungeon.boss_atk - char.total_def + Math.floor(Math.random() * 8) - 3);
            playerHp -= bDmg;
            allLog.push({ actor: 'monster', msg: `${dungeon.boss_name} deals ${bDmg} dmg!`, playerHp: Math.max(0, playerHp), monsterHp: bossHp });
        }

        if (bossDefeated) {
            const bossXp = dungeon.boss_hp; // XP = boss HP
            const bossGold = Math.floor(dungeon.boss_hp * 0.5);
            totalXp += bossXp;
            totalGold += bossGold;
            allLog.push({ actor: 'system', msg: `🎉 ${dungeon.boss_name} DEFEATED! +${bossXp} XP +${bossGold} Gold` });

            // Rewards
            if (dungeon.rewards) {
                const rewardIds = dungeon.rewards.split(',').map(Number);
                for (const rid of rewardIds) {
                    if (Math.random() < 0.5) {
                        const item = db.prepare('SELECT * FROM items WHERE id = ?').get(rid);
                        if (item) {
                            const existingInv = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(char.id, rid);
                            if (existingInv) {
                                db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(existingInv.id);
                            } else {
                                db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)').run(char.id, rid);
                            }
                            droppedItems.push(item);
                        }
                    }
                }
            }
        }
    }

    const won = playerHp > 0 && bossDefeated;

    if (won) {
        db.prepare('UPDATE characters SET xp = xp + ?, gold = gold + ?, hp = ? WHERE id = ?')
            .run(totalXp, totalGold, Math.max(1, playerHp), char.id);
    } else {
        db.prepare('UPDATE characters SET hp = ? WHERE id = ?')
            .run(Math.max(1, Math.floor(char.max_hp * 0.2)), char.id);
    }

    const updatedChar = db.prepare('SELECT * FROM characters WHERE id = ?').get(char.id);
    const levelUps = checkLevelUp(updatedChar);
    const finalChar = getCharWithEquipBonus(char.id);
    finalChar.xp_needed = xpForLevel(finalChar.level);

    res.json({
        won,
        dungeon: dungeon.name,
        bossName: dungeon.boss_name,
        bossDefeated,
        log: allLog,
        xpGained: totalXp,
        goldGained: totalGold,
        droppedItems,
        levelUps,
        character: finalChar
    });
});

// ─── CRAFTING ROUTES ───
app.get('/api/recipes', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const recipes = db.prepare(`
        SELECT cr.*, 
            r.name as result_name, r.type as result_type, r.rarity as result_rarity,
            r.atk_bonus as result_atk, r.def_bonus as result_def, r.hp_bonus as result_hp,
            i1.name as ing1_name, i2.name as ing2_name
        FROM craft_recipes cr
        JOIN items r ON cr.result_item_id = r.id
        JOIN items i1 ON cr.ingredient1_id = i1.id
        JOIN items i2 ON cr.ingredient2_id = i2.id
        ORDER BY r.rarity, r.name
    `).all();
    res.json(recipes);
});

app.post('/api/craft', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const { recipeId } = req.body;

    const recipe = db.prepare('SELECT * FROM craft_recipes WHERE id = ?').get(recipeId);
    if (!recipe) return res.json({ error: 'Recipe not found' });

    // Check ingredients
    const ing1 = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(charRow.id, recipe.ingredient1_id);
    const ing2 = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(charRow.id, recipe.ingredient2_id);

    if (!ing1 || ing1.quantity < recipe.ingredient1_qty) {
        const i1name = db.prepare('SELECT name FROM items WHERE id = ?').get(recipe.ingredient1_id);
        return res.json({ error: `Not enough ${i1name?.name || 'ingredient 1'}! Need ${recipe.ingredient1_qty}` });
    }
    if (!ing2 || ing2.quantity < recipe.ingredient2_qty) {
        const i2name = db.prepare('SELECT name FROM items WHERE id = ?').get(recipe.ingredient2_id);
        return res.json({ error: `Not enough ${i2name?.name || 'ingredient 2'}! Need ${recipe.ingredient2_qty}` });
    }

    // Consume ingredients
    if (recipe.ingredient1_id === recipe.ingredient2_id) {
        const totalNeeded = recipe.ingredient1_qty + recipe.ingredient2_qty;
        if (ing1.quantity < totalNeeded) {
            const i1name = db.prepare('SELECT name FROM items WHERE id = ?').get(recipe.ingredient1_id);
            return res.json({ error: `Not enough ${i1name?.name}! Need ${totalNeeded}` });
        }
        if (ing1.quantity > totalNeeded) {
            db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(totalNeeded, ing1.id);
        } else {
            db.prepare('DELETE FROM inventory WHERE id = ?').run(ing1.id);
        }
    } else {
        if (ing1.quantity > recipe.ingredient1_qty) {
            db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(recipe.ingredient1_qty, ing1.id);
        } else {
            db.prepare('DELETE FROM inventory WHERE id = ?').run(ing1.id);
        }
        if (ing2.quantity > recipe.ingredient2_qty) {
            db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE id = ?').run(recipe.ingredient2_qty, ing2.id);
        } else {
            db.prepare('DELETE FROM inventory WHERE id = ?').run(ing2.id);
        }
    }

    // Add result
    const existingResult = db.prepare('SELECT * FROM inventory WHERE character_id = ? AND item_id = ?').get(charRow.id, recipe.result_item_id);
    if (existingResult) {
        db.prepare('UPDATE inventory SET quantity = quantity + 1 WHERE id = ?').run(existingResult.id);
    } else {
        db.prepare('INSERT INTO inventory (character_id, item_id, quantity) VALUES (?, ?, 1)').run(charRow.id, recipe.result_item_id);
    }

    const resultItem = db.prepare('SELECT * FROM items WHERE id = ?').get(recipe.result_item_id);
    res.json({ success: true, message: `Crafted ${resultItem.name}!`, item: resultItem });
});

// ─── REST (heal) ───
app.post('/api/rest', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });

    const cost = Math.floor(charRow.level * 2);
    if (charRow.gold < cost) return res.json({ error: `Not enough gold! Need ${cost}G to rest.` });

    db.prepare('UPDATE characters SET hp = max_hp, gold = gold - ? WHERE id = ?').run(cost, charRow.id);
    const finalChar = getCharWithEquipBonus(charRow.id);
    finalChar.xp_needed = xpForLevel(finalChar.level);
    res.json({ success: true, cost, character: finalChar });
});

// ─── ONLINE PLAYERS ───
app.get('/api/players/online', (req, res) => {
    const players = [];
    for (const [, p] of onlinePlayers) {
        const char = db.prepare('SELECT name, class, level FROM characters WHERE id = ?').get(p.charId);
        if (char) players.push({ charId: p.charId, ...char });
    }
    res.json(players);
});

// ─── PVP ───
app.post('/api/pvp/duel', (req, res) => {
    if (!req.session.userId) return res.json({ error: 'Not logged in' });
    const charRow = db.prepare('SELECT id FROM characters WHERE user_id = ?').get(req.session.userId);
    if (!charRow) return res.json({ error: 'No character' });
    const { targetCharId } = req.body;
    if (!targetCharId) return res.json({ error: 'Select an opponent' });
    if (targetCharId === charRow.id) return res.json({ error: "You can't duel yourself!" });

    const attacker = getCharWithEquipBonus(charRow.id);
    const defender = getCharWithEquipBonus(targetCharId);
    if (!defender) return res.json({ error: 'Opponent not found' });

    // Check if defender is online
    let defenderOnline = false;
    for (const [, p] of onlinePlayers) {
        if (p.charId === targetCharId) { defenderOnline = true; break; }
    }
    if (!defenderOnline) return res.json({ error: 'Opponent is not online!' });

    const log = [];
    let aHp = attacker.total_max_hp;
    let dHp = defender.total_max_hp;
    let turn = 0;

    while (aHp > 0 && dHp > 0 && turn < 25) {
        turn++;
        const aDmg = Math.max(1, attacker.total_atk - defender.total_def + Math.floor(Math.random() * 6) - 3);
        dHp -= aDmg;
        log.push({ actor: 'player', msg: `${attacker.name} deals ${aDmg} dmg to ${defender.name}!`, playerHp: aHp, monsterHp: Math.max(0, dHp) });
        if (dHp <= 0) break;

        const dDmg = Math.max(1, defender.total_atk - attacker.total_def + Math.floor(Math.random() * 6) - 3);
        aHp -= dDmg;
        log.push({ actor: 'monster', msg: `${defender.name} deals ${dDmg} dmg to ${attacker.name}!`, playerHp: Math.max(0, aHp), monsterHp: dHp });
    }

    const won = dHp <= 0;
    const goldStake = Math.floor(Math.min(attacker.gold, defender.gold, 20 + attacker.level * 5) * 0.5);
    const xpReward = Math.floor(10 + defender.level * 3);

    if (won) {
        db.prepare('UPDATE characters SET gold = gold + ?, xp = xp + ? WHERE id = ?').run(goldStake, xpReward, attacker.id);
        db.prepare('UPDATE characters SET gold = gold - ? WHERE id = ?').run(goldStake, defender.id);
        const updChar = db.prepare('SELECT * FROM characters WHERE id = ?').get(attacker.id);
        checkLevelUp(updChar);
    } else {
        db.prepare('UPDATE characters SET gold = gold - ? WHERE id = ?').run(goldStake, attacker.id);
        db.prepare('UPDATE characters SET gold = gold + ? WHERE id = ?').run(goldStake, defender.id);
    }

    const finalChar = getCharWithEquipBonus(attacker.id);
    finalChar.xp_needed = xpForLevel(finalChar.level);

    // Notify defender via socket
    for (const [sid, p] of onlinePlayers) {
        if (p.charId === targetCharId) {
            io.to(sid).emit('pvp-result', {
                attackerName: attacker.name,
                won: !won,
                goldStake
            });
        }
    }

    res.json({
        won,
        opponent: { name: defender.name, class: defender.class, level: defender.level },
        log,
        goldWon: won ? goldStake : -goldStake,
        xpGained: won ? xpReward : 0,
        character: finalChar
    });
});

// ─── SOCKET.IO ───
io.on('connection', (socket) => {
    const sess = socket.request.session;
    if (!sess || !sess.userId) return;

    const char = db.prepare('SELECT * FROM characters WHERE user_id = ?').get(sess.userId);
    if (char) {
        onlinePlayers.set(socket.id, { charId: char.id, charName: char.name, userId: sess.userId });
        broadcastOnlinePlayers();
    }

    // Chat
    socket.on('chat-message', (msg) => {
        if (!msg || typeof msg !== 'string' || msg.trim().length === 0) return;
        const pInfo = onlinePlayers.get(socket.id);
        if (!pInfo) return;
        const cleanMsg = msg.trim().substring(0, 200);
        db.prepare('INSERT INTO chat_messages (character_id, message) VALUES (?, ?)').run(pInfo.charId, cleanMsg);
        io.emit('chat-message', { charName: pInfo.charName, message: cleanMsg, timestamp: new Date().toISOString() });
    });

    // Request recent chat history
    socket.on('chat-history', () => {
        const messages = db.prepare(`
            SELECT cm.message, cm.timestamp, c.name as charName
            FROM chat_messages cm JOIN characters c ON cm.character_id = c.id
            ORDER BY cm.id DESC LIMIT 50
        `).all().reverse();
        socket.emit('chat-history', messages);
    });

    socket.on('disconnect', () => {
        onlinePlayers.delete(socket.id);
        broadcastOnlinePlayers();
    });
});

function broadcastOnlinePlayers() {
    const players = [];
    for (const [, p] of onlinePlayers) {
        const char = db.prepare('SELECT name, class, level FROM characters WHERE id = ?').get(p.charId);
        if (char) players.push({ charId: p.charId, ...char });
    }
    io.emit('online-players', players);
}

// ─── Start ───
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🎮 Epic RPG Game running at http://localhost:${PORT}`);
});
