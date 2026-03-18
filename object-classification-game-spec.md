# Object Classification Game Spec

## Project

CogScreen-AI

## Goal

Upgrade the current classification game from simple geometric shape sorting to **object category sorting** using collected image assets.

The page layout and interaction style should follow the provided mockup:

- top item pool area
- lower category drop zones
- clean large-card layout
- elderly-friendly spacing and clear category labels

Images will be added manually later by the project owner.

---

## Final Game Levels

### Easy

**Land Animals vs Marine Animals**

Categories:

- 陸地動物
- 海洋動物

Examples of possible items:

- 陸地動物: 熊、牛、駱駝、羊駝、狐狸、老鼠、刺蝟
- 海洋動物: 魚、螃蟹、海豚、水母

Recommended gameplay:

- 2 categories
- 6 to 8 draggable items per round
- large visual difference between categories

---

### Medium

**Fruits vs Vegetables vs Bread**

Categories:

- 水果
- 蔬菜
- 麵包

Examples of possible items:

- 水果: 蘋果、香蕉、奇異果、葡萄、草莓
- 蔬菜: 花椰菜、小黃瓜、玉米、紅蘿蔔、番茄（if included, be consistent with your labeling decision)
- 麵包: 吐司、可頌、法國麵包、漢堡麵包

Recommended gameplay:

- 3 categories
- 9 draggable items per round
- more semantic similarity because all belong to food-related groups

---

### Hard

**Clothes vs Accessories vs Shoes vs Bags**

Categories:

- 衣服
- 配件
- 鞋類
- 包袋

Examples of possible items:

- 衣服: 上衣、外套、褲子、裙子
- 配件: 帽子、眼鏡、手錶、項鍊
- 鞋類: 球鞋、高跟鞋、拖鞋、靴子
- 包袋: 後背包、手提包、側背包、托特包

Recommended gameplay:

- 4 categories
- 8 to 12 draggable items per round
- similar daily-life objects, requiring finer category judgment

---

## Design Direction

The page should visually follow the provided reference layout:

### Main layout

1. **Top item pool area**
    - large rectangular panel
    - draggable object images displayed inside
    - items should have enough spacing for easy dragging

2. **Bottom category area**
    - large drop zones
    - category title card visually overlaps each zone, similar to the reference image
    - zones should be large enough for elderly-friendly interaction

3. **Overall interaction style**
    - clean and uncluttered
    - large fonts
    - obvious drag state feedback
    - clear correct / incorrect drop feedback

---

## UI Requirements

### Required UI elements

- game title
- current difficulty display
- progress indicator
- restart button
- back to game selection button
- score / correct count display

### Drag-and-drop interaction

When dragging an item:

- item should slightly enlarge or show shadow
- target zone should highlight when draggable enters

When dropped correctly:

- item should snap into target zone
- give visible correct feedback
- prevent duplicate scoring

When dropped incorrectly:

- show a short wrong feedback
- item should return to pool or original area

### Completion state

When all items are classified:

- show result summary
- show correct count / score
- allow replay or difficulty switch

---

## Accessibility / Elderly-friendly Design

- large drop targets
- large category labels
- avoid dense visual clutter
- avoid tiny icons
- keep interactions simple and predictable
- maintain generous spacing between draggable items
- feedback should be obvious but not overly flashy

---

## Asset Strategy

The project owner will add image assets manually.

Please design the code so image replacement is easy.

Recommended structure:

- separate level metadata from gameplay logic
- each item uses an image path + label + category
- allow future replacement of image files without rewriting core logic

Example asset fields:

- `id`
- `label`
- `image`
- `category`

---

## Recommended Data Structure

Use a structured level definition file, for example:

```js
const CLASSIFICATION_LEVELS = {
  easy: {
    title: "陸地動物 vs 海洋動物",
    categories: ["陸地動物", "海洋動物"],
    items: [
      { id: "bear", label: "熊", image: "/static/images/games/classification/bear.png", category: "陸地動物" },
      { id: "cow", label: "牛", image: "/static/images/games/classification/cow.png", category: "陸地動物" },
      { id: "fish", label: "魚", image: "/static/images/games/classification/fish.png", category: "海洋動物" },
      { id: "dolphin", label: "海豚", image: "/static/images/games/classification/dolphin.png", category: "海洋動物" }
    ]
  },
  medium: {
    title: "水果 vs 蔬菜 vs 麵包",
    categories: ["水果", "蔬菜", "麵包"],
    items: []
  },
  hard: {
    title: "衣服 vs 配件 vs 鞋類 vs 包袋",
    categories: ["衣服", "配件", "鞋類", "包袋"],
    items: []
  }
};

Level Rules
Easy

2 categories

recommended 6–8 items total

simple and visually distinct objects

Medium

3 categories

recommended 9 items total

food-related categories with moderate difficulty

Hard

4 categories

recommended 8–12 items total

daily-life wearable / carryable objects with more subtle distinctions

Suggested File Changes

Inspect and update the existing classification game files in the current project.

Likely files may include:

frontend/game-logic.html or current classification page file

related CSS file or shared stylesheet

related JavaScript game logic file

Recommended new file:

frontend/classification-levels.js

Keep the existing project architecture based on plain HTML/CSS/JS.
Do not migrate to another framework.

Functional Requirements
Core gameplay

user can select difficulty: easy / medium / hard

corresponding categories and items load correctly

user can drag items into category zones

correct drop is accepted and counted

wrong drop is rejected

items should not be scored twice

game completes when all items are correctly sorted

State handling

maintain item state (unplaced / placed)

maintain correct count

maintain score

support restart for current difficulty

allow switching difficulty without breaking state

Nice-to-have

If easy to implement, also support:

click-select + click-target mode as an alternative to drag-and-drop

simple success animation

simple sound feedback toggle

result card after round completion

Acceptance Criteria

The game is upgraded from geometric shapes to object classification

The three final level themes match exactly:

easy: 陸地動物 vs 海洋動物

medium: 水果 vs 蔬菜 vs 麵包

hard: 衣服 vs 配件 vs 鞋類 vs 包袋

The page visually follows the provided mockup structure

Images can be manually replaced later without rewriting core logic

The implementation remains compatible with the current plain HTML/CSS/JS project structure
```
