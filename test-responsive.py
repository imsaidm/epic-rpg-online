from playwright.sync_api import sync_playwright
import os, time

out_dir = r"C:\KerjaSantai\epic-rpg-game\screenshots"
os.makedirs(out_dir, exist_ok=True)

viewports = [
    {"name": "mobile-320", "width": 320, "height": 568},
    {"name": "tablet-768", "width": 768, "height": 1024},
    {"name": "desktop-1440", "width": 1440, "height": 900},
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    
    for vp in viewports:
        ctx = browser.new_context(viewport={"width": vp["width"], "height": vp["height"]})
        page = ctx.new_page()
        
        # Login page
        page.goto("http://localhost:3000")
        page.wait_for_load_state("networkidle")
        time.sleep(1)
        page.screenshot(path=os.path.join(out_dir, f"{vp['name']}-login.png"), full_page=True)
        print(f"  {vp['name']}-login.png captured")
        
        # Register and create character
        ts = str(int(time.time() * 1000))[-8:]
        page.fill('input[name="username"], #username, input[placeholder*="user" i]', f"pw{ts}")
        page.fill('input[name="password"], #password, input[placeholder*="pass" i]', "test1234")
        
        # Try to find and click register button
        reg_btn = page.query_selector('button:has-text("Register"), input[value*="Register"]')
        if reg_btn:
            reg_btn.click()
            time.sleep(1)
        
        page.screenshot(path=os.path.join(out_dir, f"{vp['name']}-after-register.png"), full_page=True)
        print(f"  {vp['name']}-after-register.png captured")
        
        # Try to create character
        name_input = page.query_selector('input[name="name"], #charName, input[placeholder*="name" i]')
        if name_input:
            name_input.fill(f"Hero{ts[-4:]}")
            class_select = page.query_selector('select')
            if class_select:
                class_select.select_option("Warrior")
            create_btn = page.query_selector('button:has-text("Create"), input[value*="Create"]')
            if create_btn:
                create_btn.click()
                time.sleep(1.5)
        
        page.screenshot(path=os.path.join(out_dir, f"{vp['name']}-game.png"), full_page=True)
        print(f"  {vp['name']}-game.png captured")
        
        ctx.close()
    
    browser.close()
    print("\nAll screenshots captured successfully!")
