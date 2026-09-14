# Raccourcis First Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Raccourcis the default first tab while preserving the Iop sword illustration and removing Ma flotte.

**Architecture:** Keep the existing `data-vue` navigation mechanism. Rebind the first rail button to `raccourcis`, remove the duplicate keyboard entry and the obsolete `v-flotte` view, then move the default `actif` class to `v-raccourcis`. Update only the nearby presentation copy that counts or names the screens.

**Tech Stack:** Static HTML, CSS and vanilla JavaScript in the autonomous OMNI design lab.

---

### Task 1: Rebind the first navigation entry

**Files:**
- Modify: `labo-omni/app.html:383`

- [ ] **Step 1: Change the first button target**

Keep the existing first button and fallback SVG, but change its target and title:

```html
<button class="actif" data-vue="raccourcis" title="Raccourcis">
```

- [ ] **Step 2: Remove the duplicate keyboard button**

Delete the later `<button data-vue="raccourcis" title="Raccourcis">` block while preserving the bottom `reglages` button.

- [ ] **Step 3: Preserve the sword illustration on the rebound button**

Replace the obsolete `flotte` mapping with:

```javascript
raccourcis: 'breeds/symbol_8', // l epee du Iop -- l entree principale d OMNI
```

### Task 2: Remove Ma flotte and make Raccourcis the default view

**Files:**
- Modify: `labo-omni/app.html:422`
- Modify: `labo-omni/app.html:809`

- [ ] **Step 1: Remove the obsolete view**

Delete the complete `<div class="vue actif" id="v-flotte">...</div>` block.

- [ ] **Step 2: Activate Raccourcis at startup**

Change its opening tag to:

```html
<div class="vue actif" id="v-raccourcis">
```

- [ ] **Step 3: Keep screen numbering coherent**

Rename the Raccourcis section comment to `1 · RACCOURCIS` and the Reglages comment to `5 · REGLAGES`. Courses, Hotel de vente and Archimonstres already occupy positions 2 through 4.

### Task 3: Update the lab copy and verify

**Files:**
- Modify: `labo-omni/app.html:920`
- Modify: `labo-omni/index.html:77`

- [ ] **Step 1: Update screen counts and order**

Describe five screens in this order: Raccourcis, Courses, Hotel de vente, Archimonstres, Reglages.

- [ ] **Step 2: Run static assertions**

Run:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('labo-omni/app.html','utf8');if(!s.includes('class=\"vue actif\" id=\"v-raccourcis\"'))process.exit(1);if(s.includes('id=\"v-flotte\"'))process.exit(2);if((s.match(/data-vue=\"raccourcis\"/g)||[]).length!==1)process.exit(3);if(!s.includes("raccourcis: 'breeds/symbol_8'"))process.exit(4);"
```

Expected: exit code 0 with no output.

- [ ] **Step 3: Verify the served page**

Run:

```bash
curl -I http://localhost:8731/app.html
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 4: Inspect a desktop screenshot**

Capture `http://localhost:8731/app.html` at a viewport wide enough to show the 1097 px OMNI window. Confirm the sword is selected, Raccourcis is visible, the keyboard button is absent, and Reglages remains at the bottom.
