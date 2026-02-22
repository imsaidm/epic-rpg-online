$ErrorActionPreference = "Continue"
$base = "http://localhost:3000"
$results = @()
$pass = 0
$fail = 0

function Test-Case($name, $condition, $detail) {
    if ($condition) {
        Write-Host "  PASS: $name" -ForegroundColor Green
        $script:pass++
        $script:results += [PSCustomObject]@{Name=$name;Status="PASS";Detail=$detail}
    } else {
        Write-Host "  FAIL: $name - $detail" -ForegroundColor Red
        $script:fail++
        $script:results += [PSCustomObject]@{Name=$name;Status="FAIL";Detail=$detail}
    }
}

Write-Host "`n========== QC ROUND 2 - Epic RPG Game ==========" -ForegroundColor Cyan

# ─── TEST 1: Registration ───
Write-Host "`n[1] Registration & Auth" -ForegroundColor Yellow
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$reg = Invoke-RestMethod "$base/api/register" -Method POST -Body (@{username="qctest_$ts";password="test1234"} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
Test-Case "Register new user" ($reg.success -eq $true) "userId=$($reg.userId)"

# ─── TEST 2: XSS / Input Sanitization ───
Write-Host "`n[2] XSS / Input Sanitization (FIX #1)" -ForegroundColor Yellow

# Create char with HTML tags in name
$xssName = '<script>alert("xss")</script>TestHero'
$createXss = Invoke-RestMethod "$base/api/character/create" -Method POST -Body (@{name=$xssName;charClass="Warrior"} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
# The sanitized name should NOT contain any HTML tags
$charName = $createXss.character.name
Test-Case "XSS: HTML tags stripped from char name" ($charName -notmatch '<') "name='$charName' (from '$xssName')"
Test-Case "XSS: Sanitized name is valid" ($charName.Length -ge 2) "length=$($charName.Length)"

# Verify the name in DB through API
$charInfo = Invoke-RestMethod "$base/api/character" -WebSession $session
Test-Case "XSS: Stored name clean" ($charInfo.name -notmatch '<|>|script') "stored='$($charInfo.name)'"

# ─── TEST 3: Shop & Potions (FIX #2) ───
Write-Host "`n[3] ATK/DEF Boost Potions (FIX #2)" -ForegroundColor Yellow

# Need gold - hunt a few times first
$goldBefore = $charInfo.gold
# Give gold by hunting
for ($i = 0; $i -lt 3; $i++) {
    try {
        $hunt = Invoke-RestMethod "$base/api/hunt" -Method POST -WebSession $session
        Start-Sleep -Milliseconds 3100
    } catch {}
}

# Get shop
$shop = Invoke-RestMethod "$base/api/shop" -WebSession $session
$atkPotion = $shop | Where-Object { $_.name -match "ATK" -and $_.type -eq "potion" }
$defPotion = $shop | Where-Object { $_.name -match "DEF" -and $_.type -eq "potion" }
Test-Case "Shop: ATK Boost Potion exists" ($null -ne $atkPotion) "id=$($atkPotion.id), price=$($atkPotion.price)"
Test-Case "Shop: DEF Boost Potion exists" ($null -ne $defPotion) "id=$($defPotion.id), price=$($defPotion.price)"

# Give enough gold (update directly through multiple hunts is slow, let's try buying)
# First check gold
$charNow = Invoke-RestMethod "$base/api/character" -WebSession $session
Write-Host "  INFO: Current gold = $($charNow.gold)" -ForegroundColor Gray

# Buy ATK potion if we have enough gold
if ($atkPotion -and $charNow.gold -ge $atkPotion.price) {
    $buyAtk = Invoke-RestMethod "$base/api/shop/buy" -Method POST -Body (@{itemId=$atkPotion.id} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
    Test-Case "Shop: Buy ATK Potion" ($buyAtk.success -eq $true) $buyAtk.message
    
    # Get inventory to find the potion
    $inv = Invoke-RestMethod "$base/api/inventory" -WebSession $session
    $atkInv = $inv | Where-Object { $_.name -match "ATK" -and $_.type -eq "potion" }
    
    if ($atkInv) {
        # Record ATK before
        $charBefore = Invoke-RestMethod "$base/api/character" -WebSession $session
        $atkBefore = $charBefore.total_atk
        $buffAtkBefore = $charBefore.buff_atk
        
        # Use ATK potion
        $useAtk = Invoke-RestMethod "$base/api/inventory/use" -Method POST -Body (@{invId=$atkInv.inv_id} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
        Test-Case "Potion: Use ATK Boost" ($useAtk.success -eq $true) $useAtk.message
        
        # Check buff is active
        $charAfter = Invoke-RestMethod "$base/api/character" -WebSession $session
        Test-Case "Potion: ATK buff active" ($charAfter.buff_atk -gt 0) "buff_atk=$($charAfter.buff_atk), total_atk=$($charAfter.total_atk) (was $atkBefore)"
        Test-Case "Potion: active_buffs populated" ($charAfter.active_buffs.Count -gt 0) "buffs=$($charAfter.active_buffs.Count)"
    }
} else {
    Write-Host "  SKIP: Not enough gold for ATK potion ($($charNow.gold) < $($atkPotion.price))" -ForegroundColor DarkYellow
    # Still test with what we have
    Test-Case "Shop: Need more gold for potion test" $false "gold=$($charNow.gold), need=$($atkPotion.price)"
}

# ─── TEST 4: Rate Limiting (FIX #6) ───
Write-Host "`n[4] Rate Limiting (FIX #6)" -ForegroundColor Yellow

# Hunt rate limit (3s cooldown)
$hunt1 = Invoke-RestMethod "$base/api/hunt" -Method POST -WebSession $session
Start-Sleep -Milliseconds 500
$hunt2 = Invoke-RestMethod "$base/api/hunt" -Method POST -WebSession $session
Test-Case "Rate Limit: Hunt blocked within 3s" ($hunt2.error -match "wait|Please") "response='$($hunt2.error)'"

# Wait for cooldown
Start-Sleep -Seconds 3

# Rest rate limit (30s)
$rest1 = Invoke-RestMethod "$base/api/rest" -Method POST -WebSession $session
Start-Sleep -Milliseconds 500
$rest2 = Invoke-RestMethod "$base/api/rest" -Method POST -WebSession $session
Test-Case "Rate Limit: Rest blocked within 30s" ($rest2.error -match "wait|Please") "response='$($rest2.error)'"

# Registration rate limit (10s)
$session2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$ts2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$reg1 = Invoke-RestMethod "$base/api/register" -Method POST -Body (@{username="rl_test1_$ts2";password="test1234"} | ConvertTo-Json) -ContentType "application/json" -WebSession $session2
Start-Sleep -Milliseconds 500
$session3 = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$reg2 = Invoke-RestMethod "$base/api/register" -Method POST -Body (@{username="rl_test2_$ts2";password="test1234"} | ConvertTo-Json) -ContentType "application/json" -WebSession $session3
Test-Case "Rate Limit: Register blocked within 10s" ($reg2.error -match "wait|Please") "response='$($reg2.error)'"

# ─── TEST 5: Equip/Unequip Toggle (FIX #8) ───
Write-Host "`n[5] Equip/Unequip Toggle (FIX #8)" -ForegroundColor Yellow

$inv = Invoke-RestMethod "$base/api/inventory" -WebSession $session
$weapon = $inv | Where-Object { $_.type -eq "weapon" } | Select-Object -First 1
if ($weapon) {
    $wasEquipped = $weapon.equipped
    Write-Host "  INFO: Weapon '$($weapon.name)' equipped=$wasEquipped" -ForegroundColor Gray
    
    # Toggle equip
    $eq1 = Invoke-RestMethod "$base/api/inventory/equip" -Method POST -Body (@{invId=$weapon.inv_id} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
    $inv2 = Invoke-RestMethod "$base/api/inventory" -WebSession $session
    $weapon2 = $inv2 | Where-Object { $_.inv_id -eq $weapon.inv_id }
    $afterToggle1 = $weapon2.equipped
    
    Test-Case "Equip Toggle: State changed" ($afterToggle1 -ne $wasEquipped) "before=$wasEquipped, after=$afterToggle1"
    
    # Toggle back
    $eq2 = Invoke-RestMethod "$base/api/inventory/equip" -Method POST -Body (@{invId=$weapon.inv_id} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
    $inv3 = Invoke-RestMethod "$base/api/inventory" -WebSession $session
    $weapon3 = $inv3 | Where-Object { $_.inv_id -eq $weapon.inv_id }
    $afterToggle2 = $weapon3.equipped
    
    Test-Case "Equip Toggle: Toggles back" ($afterToggle2 -eq $wasEquipped) "restored=$afterToggle2 (original=$wasEquipped)"
} else {
    Test-Case "Equip Toggle: No weapon found" $false "inventory empty?"
}

# ─── TEST 6: Password hashing (FIX #5) ───
Write-Host "`n[6] Password Security (FIX #5)" -ForegroundColor Yellow

# Login with the user we just created
$loginSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-RestMethod "$base/api/login" -Method POST -Body (@{username="qctest_$ts";password="test1234"} | ConvertTo-Json) -ContentType "application/json" -WebSession $loginSession
Test-Case "Password: Login works" ($login.success -eq $true) "userId=$($login.userId)"

# Wrong password
$wrongLogin = Invoke-RestMethod "$base/api/login" -Method POST -Body (@{username="qctest_$ts";password="wrongpass"} | ConvertTo-Json) -ContentType "application/json" -WebSession $loginSession
Test-Case "Password: Wrong password rejected" ($wrongLogin.error -match "Invalid") $wrongLogin.error

# ─── TEST 7: Session Secret (FIX #7) ───
Write-Host "`n[7] Session Secret (FIX #7)" -ForegroundColor Yellow

$secretFile = "C:\KerjaSantai\epic-rpg-game\.session-secret"
$secretExists = Test-Path $secretFile
Test-Case "Session: Secret file exists" $secretExists $secretFile
if ($secretExists) {
    $secret = Get-Content $secretFile -Raw
    Test-Case "Session: Secret is strong (64+ hex chars)" ($secret.Trim().Length -ge 64) "length=$($secret.Trim().Length)"
}

# ─── TEST 8: Core Features Still Work ───
Write-Host "`n[8] Core Features Regression" -ForegroundColor Yellow

# Hunt (already tested above, but verify response structure)
Start-Sleep -Seconds 3
$huntTest = Invoke-RestMethod "$base/api/hunt" -Method POST -WebSession $session
Test-Case "Feature: Hunt works" ($huntTest.monster -ne $null) "monster=$($huntTest.monster.name)"

# Dungeons
$dungeons = Invoke-RestMethod "$base/api/dungeons" -WebSession $session
Test-Case "Feature: Dungeons list" ($dungeons.Count -gt 0) "count=$($dungeons.Count)"

# Shop
$shopItems = Invoke-RestMethod "$base/api/shop" -WebSession $session
Test-Case "Feature: Shop works" ($shopItems.Count -gt 0) "items=$($shopItems.Count)"

# Recipes
$recipes = Invoke-RestMethod "$base/api/recipes" -WebSession $session
Test-Case "Feature: Crafting recipes" ($recipes.Count -gt 0) "recipes=$($recipes.Count)"

# Daily reward
$daily = Invoke-RestMethod "$base/api/daily-reward" -Method POST -WebSession $session
Test-Case "Feature: Daily reward" ($daily.success -eq $true -or $daily.error -match "already") "response=$($daily.success)$($daily.error)"

# Stats
$stats = Invoke-RestMethod "$base/api/stats" -WebSession $session
Test-Case "Feature: Stats endpoint" ($null -ne $stats.totalKills) "kills=$($stats.totalKills)"

# Online players
$online = Invoke-RestMethod "$base/api/players/online" -WebSession $session
Test-Case "Feature: Online players" ($null -ne $online) "count=$($online.Count)"

# Inventory
$inv = Invoke-RestMethod "$base/api/inventory" -WebSession $session
Test-Case "Feature: Inventory works" ($inv.Count -ge 0) "items=$($inv.Count)"

# Me endpoint
$me = Invoke-RestMethod "$base/api/me" -WebSession $session
Test-Case "Feature: /api/me works" ($me.loggedIn -eq $true) "user=$($me.username)"

# Logout
$logout = Invoke-RestMethod "$base/api/logout" -Method POST -WebSession $session
Test-Case "Feature: Logout works" ($logout.success -eq $true) "logged out"

# ─── TEST 9: Dungeon Enter ───
Write-Host "`n[9] Dungeon Test" -ForegroundColor Yellow
# Re-login
$login2 = Invoke-RestMethod "$base/api/login" -Method POST -Body (@{username="qctest_$ts";password="test1234"} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
$dung = Invoke-RestMethod "$base/api/dungeon/enter" -Method POST -Body (@{dungeonId=1} | ConvertTo-Json) -ContentType "application/json" -WebSession $session
Test-Case "Feature: Dungeon enter" ($dung.dungeon -ne $null -or $dung.error -match "level") "result=$($dung.dungeon)$($dung.error)"

# ─── SUMMARY ───
Write-Host "`n========== SUMMARY ==========" -ForegroundColor Cyan
Write-Host "PASS: $pass / $($pass + $fail)" -ForegroundColor $(if ($fail -eq 0) { "Green" } else { "Yellow" })
Write-Host "FAIL: $fail / $($pass + $fail)" -ForegroundColor $(if ($fail -gt 0) { "Red" } else { "Green" })

# Output results as JSON for parsing
$results | ConvertTo-Json -Depth 3 | Out-File "C:\KerjaSantai\epic-rpg-game\qc-results.json" -Encoding UTF8
Write-Host "`nResults saved to qc-results.json"
