-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Characters table
CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    class TEXT NOT NULL CHECK(class IN ('Warrior','Mage','Archer')),
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    hp INTEGER DEFAULT 100,
    max_hp INTEGER DEFAULT 100,
    atk INTEGER DEFAULT 10,
    def INTEGER DEFAULT 5,
    gold INTEGER DEFAULT 50,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Items table
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    rarity TEXT DEFAULT 'Common',
    atk_bonus INTEGER DEFAULT 0,
    def_bonus INTEGER DEFAULT 0,
    hp_bonus INTEGER DEFAULT 0,
    price INTEGER DEFAULT 0,
    description TEXT DEFAULT ''
);

-- Inventory table
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    equipped INTEGER DEFAULT 0,
    FOREIGN KEY (character_id) REFERENCES characters(id),
    FOREIGN KEY (item_id) REFERENCES items(id)
);

-- Monsters table
CREATE TABLE IF NOT EXISTS monsters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    hp INTEGER DEFAULT 20,
    atk INTEGER DEFAULT 5,
    def INTEGER DEFAULT 2,
    xp_reward INTEGER DEFAULT 10,
    gold_reward INTEGER DEFAULT 5,
    drops TEXT DEFAULT ''
);

-- Dungeons table
CREATE TABLE IF NOT EXISTS dungeons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    level_req INTEGER DEFAULT 1,
    boss_name TEXT NOT NULL,
    boss_hp INTEGER DEFAULT 100,
    boss_atk INTEGER DEFAULT 20,
    boss_def INTEGER DEFAULT 10,
    rewards TEXT DEFAULT ''
);

-- Craft recipes table
CREATE TABLE IF NOT EXISTS craft_recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_item_id INTEGER NOT NULL,
    ingredient1_id INTEGER NOT NULL,
    ingredient1_qty INTEGER DEFAULT 1,
    ingredient2_id INTEGER NOT NULL,
    ingredient2_qty INTEGER DEFAULT 1,
    FOREIGN KEY (result_item_id) REFERENCES items(id),
    FOREIGN KEY (ingredient1_id) REFERENCES items(id),
    FOREIGN KEY (ingredient2_id) REFERENCES items(id)
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (character_id) REFERENCES characters(id)
);

-- ===================== SAMPLE DATA =====================

-- Items: Weapons (type='weapon')
INSERT OR IGNORE INTO items (id, name, type, rarity, atk_bonus, def_bonus, hp_bonus, price, description) VALUES
(1, 'Wooden Sword', 'weapon', 'Common', 3, 0, 0, 20, 'A basic wooden sword for beginners.'),
(2, 'Iron Sword', 'weapon', 'Common', 8, 0, 0, 80, 'A sturdy iron blade.'),
(3, 'Steel Sword', 'weapon', 'Uncommon', 15, 0, 0, 200, 'A well-forged steel sword.'),
(4, 'Fire Blade', 'weapon', 'Rare', 25, 0, 0, 500, 'A blade imbued with fire magic.'),
(5, 'Shadow Dagger', 'weapon', 'Rare', 20, 0, 0, 400, 'A dagger that strikes from the shadows.'),
(6, 'Dragon Slayer', 'weapon', 'Epic', 40, 5, 0, 1500, 'Forged from dragon bones.'),
(7, 'Mystic Staff', 'weapon', 'Rare', 22, 0, 10, 450, 'A staff pulsing with arcane energy.'),
(8, 'Elven Bow', 'weapon', 'Uncommon', 18, 0, 0, 300, 'Crafted by the finest elven bowyers.'),
(9, 'Thunder Hammer', 'weapon', 'Epic', 35, 8, 0, 1200, 'Crackles with lightning on impact.'),
(10, 'Legendary Excalibur', 'weapon', 'Legendary', 60, 10, 20, 5000, 'The sword of legends.');

-- Items: Armor (type='armor')
INSERT OR IGNORE INTO items (id, name, type, rarity, atk_bonus, def_bonus, hp_bonus, price, description) VALUES
(11, 'Leather Armor', 'armor', 'Common', 0, 3, 5, 30, 'Basic leather protection.'),
(12, 'Iron Armor', 'armor', 'Common', 0, 8, 10, 100, 'Solid iron plate armor.'),
(13, 'Steel Plate', 'armor', 'Uncommon', 0, 15, 20, 300, 'Heavy steel plate armor.'),
(14, 'Mage Robe', 'armor', 'Uncommon', 5, 8, 15, 250, 'Enchanted robe for mages.'),
(15, 'Dragon Scale Armor', 'armor', 'Epic', 5, 30, 40, 2000, 'Made from real dragon scales.'),
(16, 'Shadow Cloak', 'armor', 'Rare', 3, 12, 10, 400, 'A cloak woven from shadows.');

-- Items: Potions (type='potion')
INSERT OR IGNORE INTO items (id, name, type, rarity, atk_bonus, def_bonus, hp_bonus, price, description) VALUES
(17, 'Small HP Potion', 'potion', 'Common', 0, 0, 30, 15, 'Restores 30 HP.'),
(18, 'Medium HP Potion', 'potion', 'Uncommon', 0, 0, 70, 40, 'Restores 70 HP.'),
(19, 'Large HP Potion', 'potion', 'Rare', 0, 0, 150, 100, 'Restores 150 HP.'),
(20, 'ATK Boost Potion', 'potion', 'Uncommon', 10, 0, 0, 60, 'Temporarily boosts ATK by 10.'),
(21, 'DEF Boost Potion', 'potion', 'Uncommon', 0, 10, 0, 60, 'Temporarily boosts DEF by 10.');

-- Items: Materials (type='material')
INSERT OR IGNORE INTO items (id, name, type, rarity, atk_bonus, def_bonus, hp_bonus, price, description) VALUES
(22, 'Iron Ore', 'material', 'Common', 0, 0, 0, 10, 'Raw iron ore for crafting.'),
(23, 'Magic Crystal', 'material', 'Uncommon', 0, 0, 0, 25, 'A crystal pulsing with magic.'),
(24, 'Dragon Fang', 'material', 'Rare', 0, 0, 0, 80, 'A fang from a slain dragon.'),
(25, 'Shadow Essence', 'material', 'Rare', 0, 0, 0, 60, 'Concentrated shadow energy.'),
(26, 'Wolf Pelt', 'material', 'Common', 0, 0, 0, 12, 'Fur from a wild wolf.'),
(27, 'Goblin Ear', 'material', 'Common', 0, 0, 0, 5, 'A trophy from a goblin.'),
(28, 'Skeleton Bone', 'material', 'Common', 0, 0, 0, 8, 'A bone from a skeleton.'),
(29, 'Phoenix Feather', 'material', 'Epic', 0, 0, 0, 150, 'A feather that glows with warmth.'),
(30, 'Mithril Shard', 'material', 'Rare', 0, 0, 0, 100, 'A shard of rare mithril.');

-- Monsters (15+ from level 1-20)
INSERT OR IGNORE INTO monsters (id, name, level, hp, atk, def, xp_reward, gold_reward, drops) VALUES
(1,  'Slime',           1,  20,  4,  1,  8,   3,  '17,22'),
(2,  'Rat',             1,  15,  5,  1,  6,   2,  '17'),
(3,  'Goblin',          2,  30,  7,  2,  12,  5,  '27,22'),
(4,  'Wolf',            3,  45,  10, 3,  18,  8,  '26'),
(5,  'Bandit',          4,  55,  12, 5,  22,  12, '17,22'),
(6,  'Skeleton',        5,  60,  14, 6,  28,  15, '28,22'),
(7,  'Giant Spider',    6,  75,  16, 5,  35,  18, '25'),
(8,  'Orc',             7,  90,  18, 8,  40,  22, '22,27'),
(9,  'Dark Mage',       8,  70,  22, 6,  45,  25, '23'),
(10, 'Troll',           9,  120, 20, 10, 55,  30, '22,22'),
(11, 'Vampire',         10, 100, 24, 9,  60,  35, '25,23'),
(12, 'Werewolf',        12, 130, 28, 12, 75,  40, '26,25'),
(13, 'Golem',           14, 180, 25, 20, 90,  50, '22,30'),
(14, 'Demon',           16, 200, 35, 15, 110, 60, '25,23'),
(15, 'Shadow Knight',   18, 220, 38, 18, 130, 70, '25,30'),
(16, 'Dragon',          20, 300, 45, 22, 200, 100,'24,29'),
(17, 'Ice Elemental',   11, 110, 26, 11, 65,  38, '23'),
(18, 'Fire Elemental',  13, 140, 30, 10, 80,  45, '23,29');

-- Dungeons (5+)
INSERT OR IGNORE INTO dungeons (id, name, level_req, boss_name, boss_hp, boss_atk, boss_def, rewards) VALUES
(1, 'Goblin Cave',       3,  'Goblin King',      150,  20, 8,   '2,22,22,22'),
(2, 'Dark Forest',       6,  'Forest Guardian',   250,  28, 12,  '5,25,23'),
(3, 'Undead Crypt',      10, 'Lich Lord',         400,  35, 18,  '7,23,23,28'),
(4, 'Dragon''s Lair',    15, 'Elder Dragon',      600,  48, 25,  '6,24,24,29'),
(5, 'Shadow Realm',      18, 'Shadow Emperor',    800,  55, 30,  '9,25,25,30'),
(6, 'Abyssal Depths',    20, 'Kraken Overlord',   1000, 65, 35,  '10,29,30,30');

-- Craft Recipes (10+)
INSERT OR IGNORE INTO craft_recipes (id, result_item_id, ingredient1_id, ingredient1_qty, ingredient2_id, ingredient2_qty) VALUES
(1,  2,  22, 3,  27, 2),
(2,  3,  22, 5,  23, 1),
(3,  4,  3,  1,  23, 3),
(4,  5,  22, 3,  25, 2),
(5,  6,  30, 3,  24, 2),
(6,  9,  30, 5,  23, 3),
(7,  13, 22, 5,  23, 2),
(8,  15, 24, 3,  30, 2),
(9,  16, 25, 3,  26, 2),
(10, 18, 17, 2,  23, 1),
(11, 19, 18, 2,  23, 2),
(12, 10, 6,  1,  29, 3);
