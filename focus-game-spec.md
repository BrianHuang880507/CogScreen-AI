# Focus Game Upgrade Spec

## Project

CogScreen-AI

## Goal

Upgrade the existing spot-the-difference game (`game-focus.html`) from fixed hotspot buttons to a free-click coordinate detection mode.

The game should use **one combined image** per level, where the **left and right scenes are merged into a single image**.  
The user clicks on the **right half** of the image to find differences.

Images are stored in:

`D:\Project\CogScreen-AI\static\images\games\spot-the-diff`

The implementation must fit the current project structure and should not rebuild the frontend framework.

---

## Current Direction

Use the following approach:

- Keep the existing frontend structure based on HTML/CSS/JS
- Keep `game-focus.html` as the focus game page
- Replace the current fixed `.diff-hit` button logic with:
    - free click detection on the image
    - manually defined difference regions
- Support difficulty levels:
    - easy
    - medium
    - hard

---

## Image Format

Each level uses **one combined image**:

- left scene on the left half
- right scene on the right half

Example layout:

- full image width = `W`
- full image height = `H`
- left scene area = `0 ~ W/2`
- right scene area = `W/2 ~ W`

Users should only be allowed to click the **right half**.

---

## Asset Folder

Use this folder for spot-the-difference game images:

`/static/images/games/spot-the-diff/`

Frontend should reference images by web path, for example:

- `/static/images/games/spot-the-diff/easy-01.jpg`
- `/static/images/games/spot-the-diff/medium-01.jpg`
- `/static/images/games/spot-the-diff/hard-01.jpg`

Do not use Windows absolute paths in frontend code.

---

## Difficulty Design

### Easy

- 3 differences
- difference regions should be larger
- tolerance can be more forgiving
- suitable for beginners and elderly users

### Medium

- 4 differences
- medium-sized difference regions
- normal tolerance

### Hard

- 5 differences
- smaller or less obvious difference regions
- tighter tolerance

---

## Recommended File Changes

### Existing files to inspect first

- `frontend/game-focus.html`
- `frontend/game-focus.css`
- `frontend/game-focus.js`
- any shared game navigation or result logic files if they exist
- backend static mounting behavior if needed, but do not redesign backend unless necessary

### New file to add

Recommended:

- `frontend/focus-levels.js`

This file should contain all level metadata.

---

## Level Data Structure

Each level should define:

- `id`
- `difficulty`
- `image`
- `differences`

Example:

```js
const FOCUS_LEVELS = [
    {
        id: "easy-01",
        difficulty: "easy",
        image: "/static/images/games/spot-the-diff/easy-01.jpg",
        differences: [
            {
                id: "diff-1",
                shape: "circle",
                x: 1240,
                y: 180,
                r: 45,
            },
            {
                id: "diff-2",
                shape: "rect",
                x: 1090,
                y: 520,
                w: 90,
                h: 80,
            },
            {
                id: "diff-3",
                shape: "circle",
                x: 1385,
                y: 760,
                r: 40,
            },
        ],
    },
];
```
